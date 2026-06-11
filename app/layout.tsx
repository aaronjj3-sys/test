import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Knock",
  description: "Find the right people, draft the first line, and follow up until doors open.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
