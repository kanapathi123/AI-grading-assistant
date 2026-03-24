'use client';

import { motion } from 'framer-motion';
import {
  Wand2,
  Code2,
  SlidersHorizontal,
  FlaskConical,
  Eye,
  Sparkles,
} from 'lucide-react';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] } },
};

const features = [
  {
    title: 'Prompt Editor',
    description: 'Edit and version system prompts',
    icon: Code2,
  },
  {
    title: 'Parameter Tuning',
    description: 'Adjust temperature, tokens, model selection',
    icon: SlidersHorizontal,
  },
  {
    title: 'A/B Testing',
    description: 'Compare outputs across prompt versions',
    icon: FlaskConical,
  },
  {
    title: 'Response Preview',
    description: 'Live preview of AI grading output',
    icon: Eye,
  },
];

export default function PromptPlayground() {
  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      className="relative mx-auto max-w-4xl px-4 py-12"
    >
      {/* Animated gradient border wrapper */}
      <div className="relative rounded-2xl p-[1px] overflow-hidden">
        <div
          className="absolute inset-0 animate-gradient-shift rounded-2xl"
          style={{
            background:
              'linear-gradient(135deg, #6366F1, #818CF8, #10B981, #818CF8, #6366F1)',
            backgroundSize: '200% 200%',
          }}
        />
        <div
          className="relative rounded-2xl p-8 sm:p-10"
          style={{ backgroundColor: 'var(--card-bg, #0f0f17)' }}
        >
          {/* Header */}
          <motion.div variants={item} className="mb-8 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium"
              style={{ backgroundColor: 'rgba(99,102,241,0.12)', color: '#818CF8' }}>
              <Sparkles className="h-3.5 w-3.5" />
              Coming Soon
            </div>
            <h2
              className="flex items-center justify-center gap-3 text-2xl font-bold sm:text-3xl"
              style={{ color: 'var(--foreground, #e2e8f0)' }}
            >
              <Wand2 className="h-7 w-7" style={{ color: '#6366F1' }} />
              Prompt Playground
            </h2>
            <p
              className="mx-auto mt-3 max-w-lg text-sm leading-relaxed sm:text-base"
              style={{ color: 'var(--muted, #94a3b8)' }}
            >
              Experiment with grading prompts, adjust parameters, and preview AI
              responses in real-time.
            </p>
          </motion.div>

          {/* Feature cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            {features.map((f) => (
              <motion.div
                key={f.title}
                variants={item}
                className="group cursor-pointer rounded-xl border p-5 transition-colors duration-200 hover:border-[#6366F1]/40"
                style={{
                  backgroundColor: 'var(--card-bg, #0f0f17)',
                  borderColor: 'var(--card-border, #1e293b)',
                }}
              >
                <div className="mb-2 flex items-center gap-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200 group-hover:bg-[#6366F1]/20"
                    style={{ backgroundColor: 'rgba(99,102,241,0.1)' }}
                  >
                    <f.icon className="h-4.5 w-4.5" style={{ color: '#818CF8' }} />
                  </div>
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: 'var(--foreground, #e2e8f0)' }}
                  >
                    {f.title}
                  </h3>
                </div>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: 'var(--muted, #94a3b8)' }}
                >
                  {f.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
