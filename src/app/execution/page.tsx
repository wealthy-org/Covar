import Link from "next/link";
import { ExecutionPlane } from "@/components/ExecutionPlane";

export const metadata = {
  title: "Execution plane · Covar",
  description:
    "Order path, risk gate, signer, venue boundary and restart reconciliation for Covar agents. Paper venue in this build.",
};

export default function ExecutionPage() {
  return (
    <div className="container section-tight stack gap-20">
      <div className="row between wrap gap-16">
        <div className="stack gap-8" style={{ maxWidth: 700 }}>
          <span className="eyebrow">Execution</span>
          <h1 className="h2">Order path &amp; recovery</h1>
          <p className="body">
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
