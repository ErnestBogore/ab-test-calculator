interface StatCardProps {
  title: string
  value: string
  subtitle: string
}

export function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="rounded-lg bg-white/50 p-4 shadow-sm">
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-xs text-gray-400">{subtitle}</div>
    </div>
  )
} 