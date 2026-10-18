import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Supper Club · Dinner, taken care of.",
  description:
    "Your cuisines. Your budget. A thoughtful weekly dinner plan with source-backed recipes and sandbox grocery ordering.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
