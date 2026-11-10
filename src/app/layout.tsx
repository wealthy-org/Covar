import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Covar — strategy agents with published rules",
  description:
    "Covar turns a conversation into a validated trading strategy, backtests it, runs it in practice, and lets investors fund a versioned vault. Vaults on Robinhood Chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <div className="page">
          <Nav />
          <main className="grow">{children}</main>
          <Footer />
        </div>
        <Reveal />
      </body>
    </html>
  );
}
