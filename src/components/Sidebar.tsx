'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { name: 'Curriculum Manager', path: '/' },
    { name: 'Knowledge Studio', path: '/studio' },
    { name: 'GS Dashboard', path: '/dashboard' },
    { name: 'Single Unit Studio', path: '/unit-studio' },
  ];

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-full shrink-0">
      <div className="p-6 border-b border-slate-800 flex items-center justify-center">
        <h2 className="text-xl font-black tracking-wider text-blue-400">SSC STUDIO</h2>
      </div>
      
      <nav className="flex-1 py-6 flex flex-col gap-2 px-4">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link 
              key={item.path} 
              href={item.path}
              className={`px-4 py-3 rounded-lg font-medium transition-colors ${
                isActive 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center">
        AI Knowledge Engine
      </div>
    </div>
  );
}