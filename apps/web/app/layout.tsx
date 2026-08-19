import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Digital Matter",
  description:
    "An adaptive computing runtime where the AI restructures its own interface around the situation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
