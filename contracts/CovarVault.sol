// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * CovarVault — agent vault with share accounting, deposit fee and a
 * request → close positions → settle → claim withdrawal path.
 *
 * Deployment order is fixed by the brief: TESTNET (46630) first, full suite and
 * acceptance criteria passing, then mainnet (4663) with a small controlled value.
 *
 * Deliberate design constraints:
 *  - Non-upgradeable. No proxy, no admin upgrade authority over user funds.
 *  - Single owner wallet (no multisig) — an accepted, documented risk. A timelock
 *    must be a separate contract if the owner later wants delay on admin actions.
 *  - The trading operator can report NAV and close positions, but can never
 *    redirect a withdrawal to an address other than the requesting investor.
 *  - Shares can only be minted or redeemed against a NAV that is inside the
 *    freshness window and inside the per-report deviation cap.
 *  - v2: the contract enforces the launch limits (TVL cap and per-deposit cap),
 *    trading capital can only leave to ONE owner-set trading account (the venue
 *    deposit address), and USDG owed to settled-but-unclaimed withdrawals is
 *    reserved: it can neither be allocated to the venue nor used to settle
 *    someone else's withdrawal.
 *
 * NOT audited. Do not deploy with real value before the full suite passes on
 * testnet and the accounting is reconciled against actual exchange balances.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract CovarVault {
    // ---------------------------------------------------------------- immutables
    IERC20 public immutable asset; // USDG, 6 decimals
    address public immutable feeRecipient;
    uint8 public immutable assetDecimals;

    /// @notice Shares use the same decimals as the asset so 1 share ≈ 1 unit of NAV.
    uint8 public constant shareDecimals = 6;

    // ------------------------------------------------------------------- storage
    address public owner;
    address public operator; // isolated trading authority (posts NAV, marks closures)
    bool public depositsPaused; // stops new capital, never blocks claims
    bool public closeOnly; // emergency: no new risk, exits and claims stay open

    string public name = "Covar Agent Vault";
    string public symbol = "cvSHARE";

    uint256 public totalShares;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Assets the vault believes it holds, reported by the operator.
    uint256 public reportedAssets;
    uint64 public lastNavUpdate;

    /// @notice Maximum age of a NAV report accepted for mint/redeem pricing.
    uint64 public maxNavAge = 6 hours;
    /// @notice Maximum single-report change (circuit breaker against a bad push).
    uint256 public maxNavChangeBps = 2_000; // 20%
    /// @notice Withdrawal fee, matching reference behaviour: 1% + 0.10 USDG.
    uint256 public withdrawalFeeBps = 100;
    uint256 public withdrawalFeeFlat = 100_000; // 0.10 USDG @ 6 decimals
    /// @notice Deposit fee, reference behaviour: 1% + 0.10 USDG.
    uint256 public depositFeeBps = 100;
    uint256 public depositFeeFlat = 100_000;
    /// @notice Minimum deposit to keep dust and griefing out.
    uint256 public minDeposit = 10_000_000; // 10 USDG
    /// @notice Launch limits (brief §4 "small controlled value"), enforced on-chain.
    uint256 public maxTotalAssets = 1_000_000_000; // 1,000 USDG of reported assets
    uint256 public maxDepositPerTx = 100_000_000; // 100 USDG per deposit (gross)

    /// @notice The only address trading capital may be sent to (venue deposit address).
    address public tradingAccount;
    /// @notice Cumulative USDG sent to the trading account (bookkeeping for reconciliation).
    uint256 public totalAllocated;
    /// @notice USDG owed to settled, unclaimed withdrawals. Never allocatable, never re-used.
    uint256 public reservedForClaims;

    struct WithdrawalRequest {
        address investor;
        uint256 shares; // escrowed shares
        uint256 settledAssets; // final amount pushed by the operator, net of fees
        uint64 requestedAt;
        uint64 settledAt;
        State state;
    }

    enum State {
        None,
        ClosingPositions,
        Settling,
        Claimable,
        Claimed
    }

    mapping(address => WithdrawalRequest) public requests;
    address[] public requesters;

    // -------------------------------------------------------------------- events
    event Deposit(address indexed investor, uint256 assetsIn, uint256 fee, uint256 shares);
    event WithdrawalRequested(address indexed investor, uint256 shares, uint64 at);
    event PositionsClosed(address indexed investor);
    event WithdrawalSettled(address indexed investor, uint256 netAssets);
    event WithdrawalClaimed(address indexed investor, uint256 assets);
    event NavReported(uint256 previousAssets, uint256 newAssets, uint64 at);
    event OwnerChanged(address indexed previous, address indexed next);
    event OperatorChanged(address indexed previous, address indexed next);
    event Paused(bool depositsPaused, bool closeOnly);
    event LimitsChanged(uint256 maxTotalAssets, uint256 maxDepositPerTx);
    event TradingAccountChanged(address indexed previous, address indexed next);
    event AllocatedToVenue(address indexed to, uint256 amount);

    // -------------------------------------------------------------------- errors
    error NotOwner();
    error NotOperator();
    error Paused_();
    error CloseOnly_();
    error StaleNav();
    error NavJumpTooLarge();
    error ZeroAmount();
    error BelowMinimum();
    error InsufficientShares();
    error NoRequest();
    error WrongState();
    error TransferFailed();
    error CapExceeded();
    error DepositTooLarge();
    error InsufficientLiquidity();
    error NoTradingAccount();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner) revert NotOperator();
        _;
    }

    constructor(IERC20 _asset, address _feeRecipient, address _operator) {
        asset = _asset;
        assetDecimals = _asset.decimals();
        feeRecipient = _feeRecipient;
        operator = _operator;
        owner = msg.sender;
        emit OwnerChanged(address(0), msg.sender);
    }

    // ------------------------------------------------------------------- pricing
    /// @notice NAV per share scaled to 1e18, using reported assets and outstanding shares.
    function navPerShare() public view returns (uint256) {
        if (totalShares == 0) return 1e18;
        return (reportedAssets * 1e18) / totalShares;
    }

    /// @notice Pricing must never use a stale or missing report.
    function _requireFreshNav() internal view {
        if (lastNavUpdate == 0 || block.timestamp - lastNavUpdate > maxNavAge) revert StaleNav();
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 nav = navPerShare();
        if (nav == 0) revert StaleNav();
        return (assets * 1e18) / nav;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * navPerShare()) / 1e18;
    }

    // ------------------------------------------------------------------ deposits
    /**
     * @notice Deposit asset and mint shares at the current, fresh NAV.
     * Fee is taken from the deposited amount and forwarded to feeRecipient;
     * the depositor receives shares for the net amount only.
     */
    function deposit(uint256 assets) external returns (uint256 shares) {
        if (depositsPaused) revert Paused_();
        if (closeOnly) revert CloseOnly_();
        if (assets == 0) revert ZeroAmount();
        if (assets < minDeposit) revert BelowMinimum();
        if (assets > maxDepositPerTx) revert DepositTooLarge();
        _requireFreshNav();

        uint256 fee = (assets * depositFeeBps) / 10_000 + depositFeeFlat;
        if (fee >= assets) revert ZeroAmount();
        uint256 net = assets - fee;
        if (reportedAssets + net > maxTotalAssets) revert CapExceeded();

        if (!asset.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        if (fee > 0 && !asset.transfer(feeRecipient, fee)) revert TransferFailed();

        shares = convertToShares(net);
        if (shares == 0) revert ZeroAmount();

        totalShares += shares;
        balanceOf[msg.sender] += shares;
        reportedAssets += net; // fee left the vault, net stays in accounting

        emit Deposit(msg.sender, assets, fee, shares);
    }

    // --------------------------------------------------------------- withdrawals
    /**
     * @notice Step 1: escrow shares and open a withdrawal request.
     * Shares are moved into the contract so they cannot be transferred or
     * redeemed twice while positions are being closed.
     */
    function requestWithdrawal(uint256 shares) external {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf[msg.sender] < shares) revert InsufficientShares();
        if (requests[msg.sender].state == State.ClosingPositions || requests[msg.sender].state == State.Settling) {
            revert WrongState();
        }

        balanceOf[msg.sender] -= shares;
        requests[msg.sender] = WithdrawalRequest({
            investor: msg.sender,
            shares: shares,
            settledAssets: 0,
            requestedAt: uint64(block.timestamp),
            settledAt: 0,
            state: State.ClosingPositions
        });
        requesters.push(msg.sender);

        emit WithdrawalRequested(msg.sender, shares, uint64(block.timestamp));
    }

    /// @notice Step 2 (operator): the corresponding trading position is closed.
    function markPositionsClosed(address investor) external onlyOperator {
        WithdrawalRequest storage r = requests[investor];
        if (r.state != State.ClosingPositions) revert WrongState();
        r.state = State.Settling;
        emit PositionsClosed(investor);
    }

    /**
     * @notice Step 3 (operator): push the settled amount net of withdrawal fee.
     * The assets must already have been transferred into the vault, so settling
     * can never promise funds the vault does not hold.
     */
    function settleWithdrawal(address investor, uint256 netAssets) external onlyOperator {
        WithdrawalRequest storage r = requests[investor];
        if (r.state != State.Settling) revert WrongState();
        // only USDG that is not already owed to another claimant can fund a settlement
        if (netAssets > availableLiquidity()) revert InsufficientLiquidity();

        uint256 fee = (netAssets * withdrawalFeeBps) / 10_000 + withdrawalFeeFlat;
        if (fee >= netAssets) fee = 0;

        r.settledAssets = netAssets - fee;
        r.settledAt = uint64(block.timestamp);
        r.state = State.Claimable;
        totalShares -= r.shares;
        reportedAssets -= netAssets; // reverts if the operator tries to settle more than reported
        reservedForClaims += r.settledAssets;

        if (fee > 0 && !asset.transfer(feeRecipient, fee)) revert TransferFailed();
        emit WithdrawalSettled(investor, r.settledAssets);
    }

    /// @notice Step 4 (investor): claim. Destination is always the requester.
    function claim() external {
        WithdrawalRequest storage r = requests[msg.sender];
        if (r.state != State.Claimable) revert NoRequest();
        uint256 amount = r.settledAssets;
        r.settledAssets = 0;
        r.state = State.Claimed;
        reservedForClaims -= amount;
        if (amount > 0 && !asset.transfer(msg.sender, amount)) revert TransferFailed();
        emit WithdrawalClaimed(msg.sender, amount);
    }

    // -------------------------------------------------------------------- NAV ops
    /**
     * @notice Operator pushes total assets after reconciliation with the exchange.
     * Guarded by a deviation cap and freshness window so shares cannot be minted
     * or redeemed against a manipulable value.
     */
    function reportNav(uint256 newAssets) external onlyOperator {
        if (reportedAssets > 0) {
            uint256 delta = newAssets > reportedAssets ? newAssets - reportedAssets : reportedAssets - newAssets;
            if ((delta * 10_000) / reportedAssets > maxNavChangeBps) revert NavJumpTooLarge();
        }
        emit NavReported(reportedAssets, newAssets, uint64(block.timestamp));
        reportedAssets = newAssets;
        lastNavUpdate = uint64(block.timestamp);
    }

    /**
     * @notice Move idle USDG to the trading account (the venue deposit address).
     * The destination is fixed by the owner; the operator chooses only the amount.
     * Blocked in close-only mode (no new risk) and never touches reserved claims.
     */
    function allocateToVenue(uint256 amount) external onlyOperator {
        if (closeOnly) revert CloseOnly_();
        if (amount == 0) revert ZeroAmount();
        address to = tradingAccount;
        if (to == address(0)) revert NoTradingAccount();
        if (amount > availableLiquidity()) revert InsufficientLiquidity();
        totalAllocated += amount;
        if (!asset.transfer(to, amount)) revert TransferFailed();
        emit AllocatedToVenue(to, amount);
    }

    // ------------------------------------------------------------------ admin ops
    /// @notice Pause new deposits and/or force close-only. Claims always stay open.
    function pause(bool _depositsPaused, bool _closeOnly) external onlyOwner {
        depositsPaused = _depositsPaused;
        closeOnly = _closeOnly;
        emit Paused(_depositsPaused, _closeOnly);
    }

    /// @notice Raise or lower the launch limits. Bounded so a typo cannot lock deposits out entirely.
    function setLimits(uint256 _maxTotalAssets, uint256 _maxDepositPerTx) external onlyOwner {
        require(_maxDepositPerTx >= minDeposit, "deposit cap < minimum");
        require(_maxTotalAssets >= _maxDepositPerTx, "tvl cap < deposit cap");
        maxTotalAssets = _maxTotalAssets;
        maxDepositPerTx = _maxDepositPerTx;
        emit LimitsChanged(_maxTotalAssets, _maxDepositPerTx);
    }

    /// @notice Set the single venue deposit address trading capital may be sent to.
    function setTradingAccount(address next) external onlyOwner {
        require(next != address(this), "self");
        emit TradingAccountChanged(tradingAccount, next);
        tradingAccount = next;
    }

    function setOperator(address next) external onlyOwner {
        emit OperatorChanged(operator, next);
        operator = next;
    }

    function setFees(uint256 _depositFeeBps, uint256 _depositFeeFlat, uint256 _withdrawalFeeBps, uint256 _withdrawalFeeFlat)
        external
        onlyOwner
    {
        require(_depositFeeBps <= 500 && _withdrawalFeeBps <= 500, "fee cap 5%");
        require(_depositFeeFlat <= 10_000_000 && _withdrawalFeeFlat <= 10_000_000, "flat cap 10 USDG");
        depositFeeBps = _depositFeeBps;
        depositFeeFlat = _depositFeeFlat;
        withdrawalFeeBps = _withdrawalFeeBps;
        withdrawalFeeFlat = _withdrawalFeeFlat;
    }

    function setNavRisk(uint64 _maxNavAge, uint256 _maxNavChangeBps) external onlyOwner {
        require(_maxNavAge >= 5 minutes && _maxNavAge <= 24 hours, "age bounds");
        require(_maxNavChangeBps <= 5_000, "change cap 50%");
        maxNavAge = _maxNavAge;
        maxNavChangeBps = _maxNavChangeBps;
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "zero owner");
        emit OwnerChanged(owner, next);
        owner = next;
    }

    // --------------------------------------------------------------------- views
    /// @notice USDG held by the vault that is not owed to settled withdrawals.
    function availableLiquidity() public view returns (uint256) {
        uint256 bal = asset.balanceOf(address(this));
        return bal > reservedForClaims ? bal - reservedForClaims : 0;
    }

    function requestCount() external view returns (uint256) {
        return requesters.length;
    }

    function previewDeposit(uint256 assets) external view returns (uint256 net, uint256 shares) {
        uint256 fee = (assets * depositFeeBps) / 10_000 + depositFeeFlat;
        net = assets > fee ? assets - fee : 0;
        shares = totalShares == 0 ? net : convertToShares(net);
    }
}
