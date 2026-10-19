import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Particle AI",
  description:
    "A runtime that reshapes the interface around your work: ten sensing layers read shape only, never content, " +
    "and two more read a screen and a page when you turn them on.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
