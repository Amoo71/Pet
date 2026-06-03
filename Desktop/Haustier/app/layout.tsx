import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pet",
  description: "A shared pet everyone can take care of."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
