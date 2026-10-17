import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Particle AI",
  description:
    "A runtime that reshapes the interface around your work: ten sensing layers read shape only, never content, " +
    "and an eleventh reads the screen when you turn it on.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
