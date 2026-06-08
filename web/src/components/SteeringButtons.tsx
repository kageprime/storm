type Props = {
  options: Array<{ label: string; action: string }>
  onSteer: (action: string) => void
  disabled?: boolean
}

const ACTION_COLORS: Record<string, string> = {
  approve: 'bg-green-600 hover:bg-green-700 text-white',
  continue: 'bg-storm-accent hover:bg-storm-accent-hover text-white',
  redo: 'bg-yellow-600 hover:bg-yellow-700 text-white',
  regenerate: 'bg-blue-600 hover:bg-blue-700 text-white',
  stop: 'bg-red-600 hover:bg-red-700 text-white',
  retry: 'bg-yellow-600 hover:bg-yellow-700 text-white',
  skip: 'bg-storm-border hover:bg-storm-border/80 text-storm-text',
}

export function SteeringButtons({ options, onSteer, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-2 my-3">
      {options.map((opt) => (
        <button
          key={opt.action}
          onClick={() => onSteer(opt.action)}
          disabled={disabled}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            ACTION_COLORS[opt.action] || 'bg-storm-accent hover:bg-storm-accent-hover text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
