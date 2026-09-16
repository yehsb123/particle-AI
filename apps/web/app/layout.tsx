import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Particle AI",
  description:
    "A runtime that watches the shape of your work, never its content, and reshapes the interface around it.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
