'use client';

import { motion } from 'framer-motion';
import {
  FileUp,
  BarChart3,
  Zap,
  FileText,
  Brain,
  ClipboardList,
  Search,
  Shield,
  Download,
} from 'lucide-react';

type ViewType = 'dashboard' | 'grading' | 'analytics' | 'playground';

interface DashboardProps {
  onNavigateToGrading: () => void;
  onNavigate: (view: ViewType) => void;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] } },
};

const actionCards = [
  {
    title: 'Upload Essay',
    description: 'Upload a PDF essay to begin AI-assisted grading with custom rubrics.',
    icon: FileUp,
    gradient: 'from-indigo-500 to-indigo-600',
    action: 'grading' as const,
  },
  {
    title: 'View Analytics',
    description: 'See grading trends, score distributions, and performance insights.',
    icon: BarChart3,
    gradient: 'from-emerald-500 to-emerald-600',
    action: 'analytics' as const,
  },
  {
    title: 'Prompt Playground',
    description: 'Experiment with AI grading prompts and fine-tune parameters.',
    icon: Zap,
    gradient: 'from-violet-500 to-violet-600',
    action: 'playground' as const,
  },
];

const steps = [
  { num: 1, title: 'Enter your name', description: 'Identify yourself to personalize your grading session.' },
  { num: 2, title: 'Upload a PDF essay', description: 'Select a PDF document to load into the grading workspace.' },
  { num: 3, title: 'Add your grading rubric', description: 'Define criteria and point values for consistent evaluation.' },
  { num: 4, title: 'Start AI-assisted grading', description: 'Let AI analyze the essay and provide evidence-based feedback.' },
];

const features = [
  { icon: FileText, title: 'PDF Support', description: 'Upload and view PDF essays directly in the browser.' },
  { icon: Brain, title: 'AI Grading', description: 'Gemini-powered analysis with evidence-based scoring.' },
  { icon: ClipboardList, title: 'Custom Rubrics', description: 'Define your own rubric criteria and point values.' },
  { icon: Search, title: 'Evidence-Based', description: 'Every score is backed by specific text references.' },
  { icon: Shield, title: 'Hallucination Check', description: 'Built-in verification to ensure accuracy of AI output.' },
  { icon: Download, title: 'Export Results', description: 'Download grading results as CSV for your records.' },
];

export default function Dashboard({ onNavigateToGrading, onNavigate }: DashboardProps) {
  const handleCardClick = (action: 'grading' | 'analytics' | 'playground') => {
    if (action === 'grading') {
      onNavigateToGrading();
    } else {
      onNavigate(action);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <motion.div variants={container} initial="hidden" animate="show">
        {/* Hero */}
        <motion.div variants={item} className="mb-12 text-center">
          <h1 className="mb-4 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 bg-clip-text text-4xl font-extrabold leading-tight text-transparent sm:text-5xl lg:text-6xl">
            Welcome to Essay Grader
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-[var(--muted)]">
            AI-powered essay grading with custom rubrics, evidence-based scoring, and detailed analytics.
          </p>
        </motion.div>

        {/* Action Cards */}
        <motion.div variants={item} className="mb-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {actionCards.map((card) => (
            <motion.button
              key={card.title}
              onClick={() => handleCardClick(card.action)}
              className="group cursor-pointer rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/10"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="mb-4 flex items-start gap-4">
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${card.gradient} shadow-lg`}>
                  <card.icon className="h-6 w-6 text-white" />
                </div>
                <div className="h-full w-1 self-stretch rounded-full bg-gradient-to-b opacity-60" style={{
                  backgroundImage: card.gradient.includes('indigo')
                    ? 'linear-gradient(to bottom, #6366F1, #4F46E5)'
                    : card.gradient.includes('emerald')
                    ? 'linear-gradient(to bottom, #10B981, #059669)'
                    : 'linear-gradient(to bottom, #8B5CF6, #7C3AED)',
                }} />
              </div>
              <h3 className="mb-1 text-lg font-bold">{card.title}</h3>
              <p className="text-sm text-[var(--muted)]">{card.description}</p>
            </motion.button>
          ))}
        </motion.div>

        {/* Getting Started */}
        <motion.div variants={item} className="mb-16">
          <h2 className="mb-8 text-center text-2xl font-bold">Getting Started</h2>
          <div className="relative mx-auto max-w-2xl">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 hidden h-full w-0.5 bg-gradient-to-b from-indigo-500 via-violet-500 to-purple-500 sm:block" />

            <div className="space-y-6">
              {steps.map((step, i) => (
                <motion.div
                  key={step.num}
                  variants={item}
                  className="flex gap-4 sm:gap-6"
                >
                  {/* Step number */}
                  <div className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-lg shadow-indigo-500/20">
                    {step.num}
                  </div>

                  {/* Step content */}
                  <div className={`flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 ${i < steps.length - 1 ? 'mb-0' : ''}`}>
                    <h3 className="mb-1 font-bold">{step.title}</h3>
                    <p className="text-sm text-[var(--muted)]">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Features Grid */}
        <motion.div variants={item}>
          <h2 className="mb-8 text-center text-2xl font-bold">Features</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, i) => (
              <motion.div
                key={feature.title}
                variants={item}
                className="group cursor-pointer rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-indigo-500/5"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 transition-colors duration-200 group-hover:bg-indigo-500/20">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mb-1 text-sm font-bold">{feature.title}</h3>
                <p className="text-xs text-[var(--muted)]">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
