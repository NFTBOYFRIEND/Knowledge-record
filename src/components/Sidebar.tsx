'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 bg-slate-900 text-white min-h-screen flex flex-col shadow-xl shrink-0">
      <div className="p-6 text-center border-b border-slate-700">
        <h2 className="text-xl font-bold text-blue-400 tracking-wider">SSC STUDIO</h2>
      </div>
      <nav className="flex-1 p-4 flex flex-col gap-2 font-medium">
        <Link 
          href="/" 
          className={`p-3 rounded-lg transition-colors ${pathname === '/' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
        >
          Curriculum Manager
        </Link>
        <Link 
          href="/studio" 
          className={`p-3 rounded-lg transition-colors ${pathname === '/studio' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
        >
          Knowledge Studio
        </Link>
      </nav>
    </div>
  );
}