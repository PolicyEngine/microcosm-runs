import type { Metadata } from "next";
import "./globals.css";
import "@axiom-foundation/orrery/style.css";
export const metadata: Metadata = {
  title: "Microcosm runs",
  description: "Immutable pipeline graphs viewed with Orrery",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
