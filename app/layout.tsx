import "./globals.css";
import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Back-up Water & Foam Runtime Calculator",
  description:
    "Configure up to 5 systems, a backup water source, and foam tanks to understand continuous runtime capacity."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
