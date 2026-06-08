import type { SubTask } from '../lib/api'

type Props = {
  plan: SubTask[]
  currentStep?: number
}

export function PlanDisplay({ plan, currentStep }: Props) {
  if (!plan || plan.length === 0) return null

  return (
    <div className="my-3 space-y-2">
      {plan.map((step) => {
        const isActive = step.step === currentStep
        const isPast = currentStep !== undefined && step.step < currentStep
        return (
          <div
            key={step.step}
            className={`rounded-lg border px-4 py-3 transition-colors ${
              isActive
                ? 'border-storm-accent bg-storm-accent/10'
                : isPast
                  ? 'border-storm-border bg-storm-surface/50 opacity-60'
                  : 'border-storm-border bg-storm-surface'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                  isActive
                    ? 'bg-storm-accent text-white'
                    : isPast
                      ? 'bg-green-600/30 text-green-400'
                      : 'bg-storm-border text-storm-muted'
                }`}
              >
                {isPast ? '✓' : step.step}
              </span>
              <span className="text-sm font-medium text-storm-text">
                {step.description}
              </span>
            </div>
            {step.files && step.files.length > 0 && (
              <div className="flex gap-1.5 ml-7 flex-wrap">
                {step.files.map((f) => (
                  <span
                    key={f}
                    className="text-xs px-2 py-0.5 rounded bg-storm-border/50 text-storm-muted font-mono"
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
