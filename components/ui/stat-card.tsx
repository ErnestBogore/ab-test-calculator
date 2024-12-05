interface StatCardProps {
  title: string
  value: string
  subtitle: string
}

export function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <h3 className="text-sm font-medium text-gray-500">{title}</h3>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="text-sm text-gray-600">{subtitle}</div>
    </div>
  )
} 