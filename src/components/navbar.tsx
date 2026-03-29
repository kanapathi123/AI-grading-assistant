'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  GraduationCap,
  LayoutDashboard,
  FileText,
  BarChart3,
  FlaskConical,
  User,
  Sun,
  Moon,
  Download,
} from 'lucide-react';

type ViewType = 'dashboard' | 'grading' | 'analytics' | 'playground';

interface NavbarProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  teacherName: string;
  onExportCSV: () => void;
}

const navLinks: { view: ViewType; label: string; icon: React.ElementType }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'grading', label: 'Grading', icon: FileText },
  { view: 'analytics', label: 'Analytics', icon: BarChart3 },
  { view: 'playground', label: 'Playground', icon: FlaskConical },
];

export default function Navbar({ currentView, onNavigate, teacherName, onExportCSV }: NavbarProps) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    /* On mount: check localStorage, ignore browser preference — app controls mode */
    const stored = localStorage.getItem('theme');
    const dark = stored !== 'light'; // default to dark
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  return (
    <nav className="sticky top-4 z-40 mx-4 rounded-2xl border border-[var(--navbar-border)] bg-[var(--navbar-bg)] px-4 py-2.5 backdrop-blur-xl">
      <div className="flex items-center justify-between">
        {/* Left: Brand */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <span className="hidden text-lg font-bold sm:block">Essay Grader</span>
        </div>

        {/* Center: Nav links */}
        <div className="flex items-center gap-1 rounded-xl bg-[var(--card-bg)] p-1">
          {navLinks.map(({ view, label, icon: Icon }) => {
            const isActive = currentView === view;
            return (
              <button
                key={view}
                onClick={() => onNavigate(view)}
                className={`relative flex h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors duration-200 sm:px-4 ${
                  isActive
                    ? 'text-white'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-lg bg-indigo-500"
                    transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {/* Teacher name badge */}
          <div className="hidden items-center gap-1.5 rounded-lg bg-[var(--card-bg)] px-3 py-2 text-sm font-medium md:flex">
            <User className="h-4 w-4 text-indigo-500" />
            <span className="max-w-[120px] truncate">{teacherName}</span>
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>

          {/* Export CSV */}
          <button
            onClick={onExportCSV}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-[var(--muted)] transition-colors duration-200 hover:bg-[var(--card-bg)] hover:text-[var(--foreground)]"
            aria-label="Export CSV"
          >
            <Download className="h-5 w-5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
