'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTeacherSession } from '@/hooks/use-teacher-session';
import TeacherGate from '@/components/teacher-gate';
import Navbar from '@/components/navbar';
import Dashboard from '@/components/dashboard';
import PromptPlayground from '@/components/prompt-playground';

const GradingWorkspace = dynamic(() => import('@/components/grading/grading-workspace'), { ssr: false });
const AnalyticsDashboard = dynamic(() => import('@/components/analytics/analytics-dashboard'), { ssr: false });

type ViewType = 'dashboard' | 'grading' | 'analytics' | 'playground';

const viewTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, ease: 'easeInOut' as const },
};

export default function Home() {
  const { teacherName, setTeacherName, recorder } = useTeacherSession();
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');

  /* ---- CSV export ---- */

  const handleExportCSV = useCallback(() => {
    recorder?.downloadCSV();
  }, [recorder]);

  /* ---- Gate ---- */

  if (!teacherName) {
    return <TeacherGate onSubmit={setTeacherName} />;
  }

  return (
    <div className="min-h-screen">
      <Navbar
        currentView={currentView}
        onNavigate={setCurrentView}
        teacherName={teacherName}
        onExportCSV={handleExportCSV}
      />

      <main className="pt-4">
        <AnimatePresence mode="wait">
          {/* Dashboard */}
          {currentView === 'dashboard' && (
            <motion.div key="dashboard" {...viewTransition}>
              <Dashboard
                onNavigateToGrading={() => setCurrentView('grading')}
                onNavigate={setCurrentView}
              />
            </motion.div>
          )}

          {/* Grading */}
          {currentView === 'grading' && (
            <motion.div key="grading" {...viewTransition}>
              {recorder && <GradingWorkspace recorder={recorder} />}
            </motion.div>
          )}

          {/* Analytics */}
          {currentView === 'analytics' && (
            <motion.div key="analytics" {...viewTransition}>
              <AnalyticsDashboard
                records={recorder?.getRecords() ?? []}
                teacherName={teacherName}
                onDownloadCSV={handleExportCSV}
              />
            </motion.div>
          )}

          {/* Playground */}
          {currentView === 'playground' && (
            <motion.div key="playground" {...viewTransition}>
              <PromptPlayground />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
