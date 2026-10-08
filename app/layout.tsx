import type { Metadata } from "next";
import "./globals.css";
import "./workflow.css";

export const metadata: Metadata = {
  other: { "codex-preview": "development" },
  title: "JMAX Restaurant Operations",
  description: "Daily handoffs, manager follow-through, scheduling and station training for your restaurant.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "JMAX Restaurant Operations", description: "Prepare, act and hand off.", images: ["/og.png"] },
  twitter: { card: "summary_large_image", title: "JMAX Restaurant Operations", description: "Prepare, act and hand off.", images: ["/og.png"] },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;0,900;1,700;1,800;1,900&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/></head><body>{children}</body></html>}
