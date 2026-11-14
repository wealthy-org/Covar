// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * CovarStockRouter — Covar's own entry point for spot swaps between USDG and
 * official Robinhood Stock Tokens on Robinhood Chain, with liquidity from the
 * 0x Swap API (AllowanceHolder → Settler, RWA RFQ market makers).
 *
 * What this contract does
 *   - Keeps a registry of supported Stock Tokens. Adding TSLA, AAPL, … is one
 *     owner call (setStockSupported); the router is never redeployed for that.
 *   - Takes Covar's routing fee in USDG (max 1%), on the way in for a buy and on
 *     the way out for a sell.
 *   - Executes the 0x calldata through the fixed 0x AllowanceHolder ONLY, after
 *     checking that the call is AllowanceHolder.exec for exactly the token and
 *     amount being sold.
 *   - Measures what actually arrived (balance delta), enforces the caller's
 *     minimum on chain, forwards the tokens to the caller and emits
 *     StockPurchased / StockSold.
 *
 * What it deliberately does NOT do
 *   - It holds no inventory and sets no prices: Covar is never the counterparty.
 *     Every swap fills against 0x liquidity at the quoted price, or reverts.
 *   - It holds no user funds between transactions. Approvals to the
 *     AllowanceHolder are exact and reset to zero in the same call.
 *   - No upgrade path, no operator role, no price oracle to keep fresh.
 *
 * Trust model: whoever submits swapData can only spend their own tokens in that
 * call; the on-chain minimum protects them from a bad route. Region and issuer
 * restrictions are enforced by the Covar app and the 0x RWA agreement before a
 * quote is issued.
 *
 * NOT audited. First mainnet use with small, controlled amounts.
 */

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
}

contract CovarStockRouter {
    // ------------------------------------------------------------- constants
    /// AllowanceHolder.exec(address operator, address token, uint256 amount, address target, bytes data)
    bytes4 internal constant EXEC_SELECTOR = 0x2213bc0b;
    uint16 public constant MAX_FEE_BPS = 100; // 1%

    // ------------------------------------------------------------ immutables
    address public immutable usdg;
    address public immutable allowanceHolder;

    // ----------------------------------------------------------------- state
    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    uint16 public feeBps;
    bool public paused;

    mapping(address => bool) public isStockSupported;
    address[] internal _stockList;
    mapping(address => bool) internal _listed;

    uint256 private _lock = 1;

    // ---------------------------------------------------------------- events
    event StockSupportedSet(address indexed stock, bool supported);
    event FeeSet(uint16 feeBps, address feeRecipient);
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event StockPurchased(address indexed buyer, address indexed stock, uint256 usdgIn, uint256 stockOut, uint256 fee);
    event StockSold(address indexed seller, address indexed stock, uint256 stockIn, uint256 usdgOut, uint256 fee);
    event Swept(address indexed token, address indexed to, uint256 amount);

    // ---------------------------------------------------------------- errors
    error NotAuthorized();
    error StockNotSupported();
    error ZeroAmount();
    error ZeroAddress();
    error SlippageExceeded(uint256 received, uint256 minimum);
    error BadSwapData();
    error SwapFailed(bytes reason);
    error TransferFailed();
    error FeeTooHigh();
    error IsPaused();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotAuthorized();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(address _usdg, address _allowanceHolder, address _feeRecipient, uint16 _feeBps) {
        if (_usdg == address(0) || _allowanceHolder == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        usdg = _usdg;
        allowanceHolder = _allowanceHolder;
        owner = msg.sender;
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeSet(_feeBps, _feeRecipient);
    }

    // ============================================================== registry

    /// Add or remove a Stock Token. Only official Robinhood token addresses belong here.
    function setStockSupported(address stock, bool supported) external onlyOwner {
        if (stock == address(0) || stock == usdg) revert ZeroAddress();
        isStockSupported[stock] = supported;
        if (supported && !_listed[stock]) {
            _listed[stock] = true;
            _stockList.push(stock);
        }
        emit StockSupportedSet(stock, supported);
    }

    /// Every token ever registered (check isStockSupported for the current flag).
    function stockList() external view returns (address[] memory) {
        return _stockList;
    }

    function setFee(uint16 _feeBps, address _feeRecipient) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (_feeRecipient == address(0)) revert ZeroAddress();
        feeBps = _feeBps;
        feeRecipient = _feeRecipient;
        emit FeeSet(_feeBps, _feeRecipient);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotAuthorized();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// The router holds nothing between calls; this only rescues tokens sent to it by mistake.
    function sweep(address token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20Min(token).balanceOf(address(this));
        _safeTransfer(token, to, bal);
        emit Swept(token, to, bal);
    }

    // ================================================================= swaps

    /**
     * USDG → Stock Token.
     * @param stock        supported Stock Token
     * @param usdgAmount   total USDG the caller spends (fee included), 6 decimals
     * @param minStockOut  minimum Stock Token the caller must receive
     * @param swapData     0x quote transaction data for selling (usdgAmount − fee) USDG,
     *                     quoted with taker = this router
     */
    function buyStock(address stock, uint256 usdgAmount, uint256 minStockOut, bytes calldata swapData)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 stockOut)
    {
        if (!isStockSupported[stock]) revert StockNotSupported();
        if (usdgAmount == 0) revert ZeroAmount();
        uint256 fee = (usdgAmount * feeBps) / 10_000;
        uint256 net = usdgAmount - fee;

        _safeTransferFrom(usdg, msg.sender, address(this), usdgAmount);
        if (fee > 0) _safeTransfer(usdg, feeRecipient, fee);

        uint256 usdgBefore = IERC20Min(usdg).balanceOf(address(this));
        uint256 stockBefore = IERC20Min(stock).balanceOf(address(this));
        _swap(usdg, net, swapData);
        stockOut = IERC20Min(stock).balanceOf(address(this)) - stockBefore;
        if (stockOut < minStockOut || stockOut == 0) revert SlippageExceeded(stockOut, minStockOut);

        // any USDG the route did not use goes back to the buyer
        uint256 usdgAfter = IERC20Min(usdg).balanceOf(address(this));
        uint256 spent = usdgBefore - usdgAfter;
        if (spent < net) _safeTransfer(usdg, msg.sender, net - spent);

        _safeTransfer(stock, msg.sender, stockOut);
        emit StockPurchased(msg.sender, stock, fee + spent, stockOut, fee);
    }

    /**
     * Stock Token → USDG.
     * @param stock        supported Stock Token
     * @param stockAmount  Stock Token the caller sells
     * @param minUsdgOut   minimum USDG the caller must receive AFTER Covar's fee
     * @param swapData     0x quote transaction data for selling stockAmount, taker = this router
     */
    function sellStock(address stock, uint256 stockAmount, uint256 minUsdgOut, bytes calldata swapData)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 usdgOut)
    {
        if (!isStockSupported[stock]) revert StockNotSupported();
        if (stockAmount == 0) revert ZeroAmount();

        _safeTransferFrom(stock, msg.sender, address(this), stockAmount);

        uint256 usdgBefore = IERC20Min(usdg).balanceOf(address(this));
        uint256 stockBefore = IERC20Min(stock).balanceOf(address(this));
        _swap(stock, stockAmount, swapData);
        uint256 gross = IERC20Min(usdg).balanceOf(address(this)) - usdgBefore;
        uint256 fee = (gross * feeBps) / 10_000;
        usdgOut = gross - fee;
        if (usdgOut < minUsdgOut || usdgOut == 0) revert SlippageExceeded(usdgOut, minUsdgOut);

        // any Stock Token the route did not use goes back to the seller
        uint256 used = stockBefore - IERC20Min(stock).balanceOf(address(this));
        if (used < stockAmount) _safeTransfer(stock, msg.sender, stockAmount - used);

        if (fee > 0) _safeTransfer(usdg, feeRecipient, fee);
        _safeTransfer(usdg, msg.sender, usdgOut);
        emit StockSold(msg.sender, stock, used, usdgOut, fee);
    }

    // ============================================================= internals

    /// Approve exactly `amount` to the AllowanceHolder, run the 0x call, reset the approval.
    function _swap(address sellToken, uint256 amount, bytes calldata swapData) internal {
        if (swapData.length < 4 + 32 * 5 || bytes4(swapData[:4]) != EXEC_SELECTOR) revert BadSwapData();
        (, address token, uint256 amt,,) = abi.decode(swapData[4:], (address, address, uint256, address, bytes));
        if (token != sellToken || amt != amount) revert BadSwapData();

        _safeApprove(sellToken, allowanceHolder, amount);
        (bool ok, bytes memory ret) = allowanceHolder.call(swapData);
        if (!ok) revert SwapFailed(ret);
        _safeApprove(sellToken, allowanceHolder, 0);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        _call(token, abi.encodeWithSelector(0xa9059cbb, to, amount));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeWithSelector(0x23b872dd, from, to, amount));
    }

    function _safeApprove(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeWithSelector(0x095ea7b3, spender, amount));
    }

    /// Works with tokens that return nothing as well as those that return bool.
    function _call(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) revert TransferFailed();
    }
}
