import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SSC Knowledge Studio",
  description: "Curriculum and AI Knowledge Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* Add suppressHydrationWarning here to prevent browser extensions from crashing Next.js */}
      <body 
        className={`${inter.className} flex h-screen bg-gray-100 overflow-hidden`}
        suppressHydrationWarning
      >
        <Sidebar />
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </body>
    </html>
  );
}