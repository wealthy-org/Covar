import Link from "next/link";
import { notFound } from "next/navigation";
import { ExecutionPlane } from "@/components/ExecutionPlane";
import { IS_MAINNET } from "@/lib/chain";

export const metadata = {
  title: "Execution plane · Covar",
  description:
    "Order path, risk gate, signer, venue boundary and restart reconciliation for Covar agents. ",
};

export default function ExecutionPage() {
  // operator view of the paper venue — not part of the mainnet product
  if (IS_MAINNET) notFound();
  return (
    <div className="wrap-md page-pad stack gap-20">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 700 }}>
          <span className="label-dot">Execution</span>
          <h1 className="page-title">Order path &amp; recovery</h1>
          <p className="page-sub">
            An agent&apos;s intent is journaled before it is risk-checked, signed or sent anywhere. This page reports what
            the four services actually hold: the risk gate, the signer, the venue and the order state machine — including
            what happened the last time the process was restarted mid-flight.
          </p>
        </div>
        <div className="row gap-8">
          <Link href="/docs#execution" className="btn btn-secondary">
            Runbook
          </Link>
          <Link href="/portfolio" className="btn btn-primary">
            My money
          </Link>
        </div>
      </div>

      <ExecutionPlane />
    </div>
  );
}
