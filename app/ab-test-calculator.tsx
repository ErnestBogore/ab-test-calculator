"use client"

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ErrorBar } from 'recharts'
import { Plus, Download, Trash } from 'lucide-react'
import { Label as RechartsLabel } from 'recharts'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

interface BusinessMetrics {
  pipelineValue: number
  closeRate: number
  monthlyVisitors: number
}

interface TestVariant {
  name: string
  visitors: number
  conversions: number
}

interface TestResults {
  winner: string
  improvement: number
  monthlyRevenue: number
  riskLevel: 'low' | 'medium' | 'high'
  variants: {
    key: string
    name: string
    rate: number
    error: number
    revenue: number
    visitors: number
  }[]
  revenueImpact: {
    monthly: number
    annual: number
  }
}

interface Recommendation {
  text: string
  color: string
  confidence: 'high' | 'medium' | 'low'
  action: string
}

// Add validation interfaces
interface ValidationError {
  field: string
  message: string
}

interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
}

// Add a comprehensive currency formatter
const formatCurrency = (value: number, options?: { 
  showSign?: boolean,
  minimumFractionDigits?: number 
}) => {
  const { showSign = false, minimumFractionDigits = 0 } = options || {}
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits: minimumFractionDigits
  }).format(Math.abs(value))

  return showSign && value > 0 ? `+${formatted}` : formatted
}

// Add statistical utility functions
const calculateConversionRate = (conversions: number, visitors: number): number => {
  if (visitors === 0) return 0
  return (conversions / visitors) * 100
}

const calculateStandardError = (rate: number, visitors: number): number => {
  if (visitors === 0) return 0
  const proportion = rate / 100
  return Math.sqrt((proportion * (1 - proportion)) / visitors) * 100
}

// Add confidence interval calculation
const calculateConfidenceInterval = (rate: number, visitors: number): [number, number] => {
  const z = 1.96 // 95% confidence level
  const se = Math.sqrt((rate / 100 * (1 - rate / 100)) / visitors)
  return [
    Math.max(0, rate - (z * se * 100)),
    Math.min(100, rate + (z * se * 100))
  ]
}

const formatNumber = (value: number) => 
  new Intl.NumberFormat().format(value)

const rgb = (r: number, g: number, b: number) => r + g * 256 + b * 65536

export default function ABTestCalculator() {
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetrics>({
    pipelineValue: 0,
    closeRate: 0,
    monthlyVisitors: 0
  })

  const [variants, setVariants] = useState<Record<string, TestVariant>>({
    control: { name: 'Control', visitors: 0, conversions: 0 },
    variant: { name: 'Variant', visitors: 0, conversions: 0 }
  })

  const validateInputs = (): ValidationResult => {
    const errors: ValidationError[] = []

    // Business metrics validation
    if (businessMetrics.pipelineValue <= 0) {
      errors.push({ field: 'pipelineValue', message: 'Pipeline value must be greater than 0' })
    }
    if (businessMetrics.closeRate <= 0 || businessMetrics.closeRate > 100) {
      errors.push({ field: 'closeRate', message: 'Close rate must be between 0 and 100' })
    }
    if (businessMetrics.monthlyVisitors <= 0) {
      errors.push({ field: 'monthlyVisitors', message: 'Monthly visitors must be greater than 0' })
    }

    // Only validate default control and variant
    ['control', 'variant'].forEach(key => {
      const variant = variants[key]
      if (variant.visitors <= 0) {
        errors.push({ field: `${key}Visitors`, message: `${variant.name} visitors must be greater than 0` })
      }
      if (variant.conversions < 0) {
        errors.push({ field: `${key}Conversions`, message: `${variant.name} conversions cannot be negative` })
      }
      if (variant.conversions > variant.visitors) {
        errors.push({ field: `${key}Conversions`, message: `${variant.name} conversions cannot exceed visitors` })
      }
    })

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  const calculateResults = (): TestResults | null => {
    const validation = validateInputs()
    if (!validation.isValid) return null

    try {
      // Start with default variants
      let variantResults = ['control', 'variant'].map(key => {
        const variant = variants[key]
        const rate = calculateConversionRate(variant.conversions, variant.visitors)
        return {
          key,
          name: variant.name,
          rate,
          error: calculateStandardError(rate, variant.visitors),
          revenue: businessMetrics.monthlyVisitors * (rate / 100) * businessMetrics.pipelineValue * (businessMetrics.closeRate / 100),
          visitors: variant.visitors
        }
      })

      // Add additional variants only if they have valid data
      const additionalVariants = Object.entries(variants)
        .filter(([key]) => !['control', 'variant'].includes(key))
        .map(([key, variant]) => {
          if (variant.visitors <= 0 || variant.conversions < 0 || variant.conversions > variant.visitors) {
            return null
          }
          const rate = calculateConversionRate(variant.conversions, variant.visitors)
          return {
            key,
            name: variant.name,
            rate,
            error: calculateStandardError(rate, variant.visitors),
            revenue: businessMetrics.monthlyVisitors * (rate / 100) * businessMetrics.pipelineValue * (businessMetrics.closeRate / 100),
            visitors: variant.visitors
          }
        })
        .filter((result): result is NonNullable<typeof result> => result !== null)

      variantResults = [...variantResults, ...additionalVariants]

      const controlResult = variantResults.find(v => v.key === 'control')!
      const bestVariant = variantResults
        .filter(v => v.key !== 'control')
        .reduce((best, current) => 
          current.rate > best.rate ? current : best
        )

      const improvement = ((bestVariant.rate - controlResult.rate) / controlResult.rate) * 100
      const monthlyImpact = bestVariant.revenue - controlResult.revenue

      // Calculate significance against control for all variants
      const significantResults = variantResults.map(variant => {
        if (variant.key === 'control') return true
        const zScore = Math.abs(variant.rate - controlResult.rate) / 
          Math.sqrt(Math.pow(variant.error, 2) + Math.pow(controlResult.error, 2))
        return zScore > 1.96
      })

      return {
        winner: bestVariant.rate > controlResult.rate ? bestVariant.name : controlResult.name,
        improvement,
        monthlyRevenue: bestVariant.revenue,
        riskLevel: significantResults.every(s => s) ? 
          (Math.abs(improvement) > 20 ? 'low' : 'medium') : 
          'high',
        variants: variantResults,
        revenueImpact: {
          monthly: monthlyImpact,
          annual: monthlyImpact * 12
        }
      }
    } catch (error) {
      console.error('Calculation error:', error)
      return null
    }
  }

  const formatRevenue = (value: number) => 
    `$${Math.abs(value).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    })}`

  const formatPercent = (value: number) =>
    `${Math.abs(value).toFixed(2)}%`

  const getRecommendation = (
    improvement: number,
    sampleSize: number,
    requiredSample: number
  ): Recommendation => {
    const sampleConfidence = sampleSize >= requiredSample ? 'high' : 
      sampleSize >= requiredSample * 0.5 ? 'medium' : 'low'
    
    if (sampleConfidence === 'low') {
      return {
        text: 'Need More Data',
        color: '#6B7280', // gray-500
        confidence: 'low',
        action: 'Continue test to reach required sample size'
      }
    }

    if (improvement > 10) {
      return {
        text: 'Implement Variant',
        color: '#059669', // green-600
        confidence: sampleConfidence,
        action: 'Strong positive impact on revenue'
      }
    }

    if (improvement < -10) {
      return {
        text: 'Keep Control',
        color: '#DC2626', // red-600
        confidence: sampleConfidence,
        action: 'Variant shows significant decline'
      }
    }

    return {
      text: 'No Clear Winner',
      color: '#5e62d1',
      confidence: sampleConfidence,
      action: 'Differences are not significant enough'
    }
  }

  const renderAnalysis = (results: TestResults) => {
    const { variants, revenueImpact, improvement } = results
    const controlVariant = variants.find(v => v.key === 'control')!

    const totalVisitors = Object.values(variants).reduce((sum, v) => sum + v.visitors, 0)

    return (
      <div className="space-y-4 text-black">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <h3 className="text-sm font-medium text-gray-500 flex items-center gap-1">
              Monthly Revenue Impact
              <span 
                className="text-xs text-gray-400 hover:text-gray-600 cursor-help" 
                title="The additional monthly revenue you could generate by implementing the winning variant, based on your current monthly visitors and close rate."
              >
                ⓘ
              </span>
            </h3>
            <p className={`text-2xl font-bold ${revenueImpact.monthly >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(revenueImpact.monthly, { showSign: true })}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500 flex items-center gap-1">
              Conversion Change
              <span 
                className="text-xs text-gray-400 hover:text-gray-600 cursor-help" 
                title="The percentage difference in conversion rate between the best performing variant and the control. A positive number means the variant converts better than the control."
              >
                ⓘ
              </span>
            </h3>
            <p className={`text-2xl font-bold ${improvement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {improvement >= 0 ? '+' : '-'}{formatPercent(improvement)}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-500">Recommendation</h3>
            <p className="text-2xl font-bold" style={{ color: getRecommendation(improvement, totalVisitors, 10000).color }}>
              {getRecommendation(improvement, totalVisitors, 10000).text}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {getRecommendation(improvement, totalVisitors, 10000).action}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-500">Confidence:</span>
              <span 
                className={`text-xs font-medium ${
                  getRecommendation(improvement, totalVisitors, 10000).confidence === 'high' ? 'text-green-600' :
                  getRecommendation(improvement, totalVisitors, 10000).confidence === 'medium' ? 'text-yellow-600' :
                  'text-red-600'
                }`}
                title="Confidence level is based on sample size. High: >10,000 visitors, Medium: >5,000 visitors, Low: <5,000 visitors. Higher confidence means more reliable results."
              >
                {getRecommendation(improvement, totalVisitors, 10000).confidence.toUpperCase()}
              </span>
              <span className="text-xs text-gray-400 hover:text-gray-600 cursor-help" title="Confidence level indicates how reliable the test results are based on sample size. More visitors = higher confidence.">
                ⓘ
              </span>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg space-y-2">
          {variants.map(variant => {
            const [lower, upper] = calculateConfidenceInterval(
              variant.rate,
              variants.find(v => v.key === variant.key)!.visitors
            )
            
            const isControl = variant.key === 'control'
            const variantImprovement = isControl ? 0 : 
              ((variant.rate - controlVariant.rate) / controlVariant.rate) * 100

            return (
              <div key={variant.key} className="mb-4">
                <p>
                  <strong>{variant.name}:</strong> {formatPercent(variant.rate)} conversion rate
                  <span className="text-gray-500 text-sm ml-2">
                    (95% confidence: true rate lies between {formatPercent(lower)} and {formatPercent(upper)})
                  </span>
                  <span className="block text-sm text-gray-600 mt-1">
                    {isControl ? 'Generates' : 'Would generate'} {formatCurrency(variant.revenue)} monthly revenue at current traffic
                  </span>
                  {!isControl && (
                    <span className={`block text-sm mt-1 ${variantImprovement >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {variantImprovement >= 0 ? 'Outperforms' : 'Underperforms'} control by {formatPercent(Math.abs(variantImprovement))}
                    </span>
                  )}
                </p>
              </div>
            )
          })}

          <p className="font-medium text-[#5e62d1] mt-4">
            Best variant {improvement >= 0 ? 'outperforms' : 'underperforms'} control by {formatPercent(Math.abs(improvement))}
            <span className="block text-sm mt-1">
              This means {improvement >= 0 ? 'an extra' : 'a loss of'} {formatCurrency(Math.abs(revenueImpact.monthly))} per month
              based on your {formatNumber(businessMetrics.monthlyVisitors)} monthly visitors and {' '}
              {formatPercent(businessMetrics.closeRate)} close rate
            </span>
          </p>
        </div>
      </div>
    )
  }

  const renderChart = (results: TestResults) => {
    const { variants } = results
    
    // Create data for all variants
    const data = variants.map(variant => ({
      name: variant.name,
      revenue: variant.revenue,
      ci: calculateConfidenceInterval(variant.rate, variants.find(v => v.key === variant.key)!.visitors)
    }))

    return (
      <ResponsiveContainer width="100%" height={400}>
        <BarChart 
          data={data}
          margin={{ top: 20, right: 30, left: 60, bottom: 5 }}
        >
          <CartesianGrid 
            strokeDasharray="3 3"
            stroke="#e5e7eb"
            vertical={false}
          />
          <XAxis 
            dataKey="name"
            tick={{ fill: '#000000', fontSize: 14 }}
            axisLine={{ stroke: '#e5e7eb' }}
          />
          <YAxis 
            domain={[0, Math.max(...data.map(d => d.revenue)) + Math.max(...data.map(d => d.ci).map(ci => ci[1] - ci[0]))]}
            tickFormatter={(value) => formatCurrency(value)}
            tick={{ fill: '#000000', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={{ stroke: '#e5e7eb' }}
          >
            <RechartsLabel 
              value="Monthly Revenue" 
              angle={-90} 
              position="insideLeft"
              offset={-45}
              style={{ textAnchor: 'middle', fill: '#000000', fontSize: 14 }}
            />
          </YAxis>
          <Tooltip 
            formatter={(value: any) => formatCurrency(Number(value))}
            labelStyle={{ color: '#5e62d1', fontWeight: 600 }}
            contentStyle={{ 
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '8px'
            }}
          />
          <Bar 
            dataKey="revenue" 
            fill="#5e62d1"
            label={{
              position: 'top',
              content: ({ value, x, y, width }) => (
                <text
                  x={Number(x) + Number(width) / 2}
                  y={Number(y) - 10}
                  fill="#000000"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="14"
                  fontWeight="500"
                >
                  {formatCurrency(Number(value))}
                </text>
              )
            }}
          >
            <ErrorBar dataKey="ci" width={4} strokeWidth={2} stroke="#464646" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    )
  }

  const exportToPDF = async () => {
    const results = calculateResults()
    if (!results) return

    const pdf = new jsPDF('p', 'pt', 'a4')
    const width = pdf.internal.pageSize.getWidth()
    const margin = 40
    let yPos = margin
    const totalVisitors = Object.values(variants).reduce((sum, v) => sum + v.visitors, 0)

    // Title
    pdf.setFontSize(24)
    pdf.setTextColor(94, 98, 209) // #5e62d1
    pdf.text('Marketing A/B Test Results', margin, yPos)
    yPos += 40

    // Business Metrics Section
    pdf.setFontSize(18)
    pdf.setTextColor(0)
    pdf.text('Business Metrics', margin, yPos)
    yPos += 25

    pdf.setFontSize(12)
    pdf.setDrawColor(229, 231, 235) // #e5e7eb
    pdf.setFillColor(249, 250, 251) // #f9fafb
    pdf.rect(margin, yPos, width - 2 * margin, 80, 'FD')
    yPos += 20

    const metrics = [
      ['Pipeline Value', formatCurrency(businessMetrics.pipelineValue)],
      ['Close Rate', formatPercent(businessMetrics.closeRate)],
      ['Monthly Visitors', formatNumber(businessMetrics.monthlyVisitors)]
    ]

    metrics.forEach(([label, value]) => {
      pdf.setTextColor(107, 114, 128) // #6b7280
      pdf.text(label, margin + 10, yPos)
      pdf.setTextColor(0)
      pdf.text(value, margin + 150, yPos)
      yPos += 20
    })
    yPos += 20

    // Test Data Section
    pdf.setFontSize(18)
    pdf.text('Test Data', margin, yPos)
    yPos += 25

    Object.entries(variants).forEach(([key, variant]) => {
      pdf.setFontSize(14)
      pdf.setTextColor(0)
      pdf.text(variant.name, margin, yPos)
      yPos += 20

      pdf.setFontSize(12)
      pdf.setTextColor(107, 114, 128)
      const data = [
        ['Visitors', formatNumber(variant.visitors)],
        ['Conversions', formatNumber(variant.conversions)],
        ['Conversion Rate', formatPercent(calculateConversionRate(variant.conversions, variant.visitors))]
      ]

      data.forEach(([label, value]) => {
        pdf.text(`${label}: ${value}`, margin + 10, yPos)
        yPos += 15
      })
      yPos += 10
    })

    // Results Section (New Page)
    pdf.addPage()
    yPos = margin

    pdf.setFontSize(18)
    pdf.setTextColor(94, 98, 209)
    pdf.text('Revenue Impact Analysis', margin, yPos)
    yPos += 40

    // Key Metrics Box
    const metrics_box_height = 80
    pdf.setDrawColor(229, 231, 235)
    pdf.setFillColor(249, 250, 251)
    pdf.rect(margin, yPos, width - 2 * margin, metrics_box_height, 'FD')

    // Three columns for key metrics
    const colWidth = (width - 2 * margin) / 3
    pdf.setFontSize(12)

    // Monthly Revenue Impact
    pdf.setTextColor(107, 114, 128)
    pdf.text('Monthly Revenue Impact', margin + 10, yPos + 20)
    pdf.setTextColor(results.revenueImpact.monthly >= 0 ? rgb(22, 163, 74) : rgb(220, 38, 38))
    pdf.setFontSize(16)
    pdf.text(formatCurrency(results.revenueImpact.monthly, { showSign: true }), margin + 10, yPos + 45)

    // Conversion Change
    pdf.setFontSize(12)
    pdf.setTextColor(107, 114, 128)
    pdf.text('Conversion Change', margin + colWidth + 10, yPos + 20)
    pdf.setTextColor(results.improvement >= 0 ? rgb(22, 163, 74) : rgb(220, 38, 38))
    pdf.setFontSize(16)
    pdf.text(`${results.improvement >= 0 ? '+' : '-'}${formatPercent(Math.abs(results.improvement))}`, margin + colWidth + 10, yPos + 45)

    // Recommendation
    const recommendation = getRecommendation(
      results.improvement,
      totalVisitors,
      10000
    )
    pdf.setFontSize(12)
    pdf.setTextColor(107, 114, 128)
    pdf.text('Recommendation', margin + 2 * colWidth + 10, yPos + 20)
    pdf.setTextColor(0)
    pdf.setFontSize(16)
    pdf.text(recommendation.text, margin + 2 * colWidth + 10, yPos + 45)
    pdf.setFontSize(10)
    pdf.text(recommendation.action, margin + 2 * colWidth + 10, yPos + 60)

    yPos += metrics_box_height + 40

    // Detailed Analysis
    pdf.setFontSize(14)
    pdf.setTextColor(0)
    results.variants.forEach(variant => {
      const [lower, upper] = calculateConfidenceInterval(variant.rate, variant.visitors)
      
      pdf.text(`${variant.name}:`, margin, yPos)
      yPos += 20
      pdf.setFontSize(12)
      pdf.text(`Conversion Rate: ${formatPercent(variant.rate)}`, margin + 10, yPos)
      pdf.setTextColor(107, 114, 128)
      pdf.text(`(95% confidence: ${formatPercent(lower)} - ${formatPercent(upper)})`, margin + 200, yPos)
      yPos += 15
      pdf.text(`Monthly Revenue: ${formatCurrency(variant.revenue)}`, margin + 10, yPos)
      yPos += 25
      pdf.setTextColor(0)
    })

    // Add chart on a new page
    try {
      const chartElement = document.querySelector('.recharts-wrapper') as HTMLElement
      if (chartElement) {
        pdf.addPage()
        const canvas = await html2canvas(chartElement)
        const chartImage = canvas.toDataURL('image/png')
        const imgWidth = width - 2 * margin
        const imgHeight = (canvas.height * imgWidth) / canvas.width
        
        pdf.text('Revenue Comparison', margin, margin)
        pdf.addImage(chartImage, 'PNG', margin, margin + 20, imgWidth, imgHeight)
      }
    } catch (error) {
      console.error('Error generating chart image:', error)
    }

    // Save the PDF
    pdf.save('ab-test-results.pdf')
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-[#5e62d1]">Marketing A/B Test Calculator</h1>

      {/* Business Metrics Card */}
      <Card>
        <CardHeader>
          <CardTitle>Business Metrics</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Label>Pipeline Value ($)</Label>
            <Input
              type="number"
              value={businessMetrics.pipelineValue || ''}
              onChange={(e) => setBusinessMetrics(prev => ({
                ...prev,
                pipelineValue: Number(e.target.value)
              }))}
              placeholder={formatCurrency(1000)}
            />
          </div>
          <div className="space-y-2">
            <Label>Close Rate (%)</Label>
            <Input
              type="number"
              value={businessMetrics.closeRate || ''}
              onChange={(e) => setBusinessMetrics(prev => ({
                ...prev,
                closeRate: Number(e.target.value)
              }))}
              placeholder="e.g. 20"
            />
          </div>
          <div className="space-y-2">
            <Label>Monthly Visitors</Label>
            <Input
              type="number"
              value={businessMetrics.monthlyVisitors || ''}
              onChange={(e) => setBusinessMetrics(prev => ({
                ...prev,
                monthlyVisitors: Number(e.target.value)
              }))}
              placeholder="e.g. 10000"
            />
          </div>
        </CardContent>
      </Card>

      {/* Test Data Card */}
      <Card>
        <CardHeader>
          <CardTitle>Test Data</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Default Control and Variant */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {['control', 'variant'].map((key) => (
              <div key={`default-${key}`} className="space-y-4">
                <div className="space-y-2">
                  <Label>Version Name</Label>
                  <Input
                    value={variants[key].name}
                    onChange={(e) => setVariants(prev => ({
                      ...prev,
                      [key]: { ...prev[key], name: e.target.value }
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Visitors</Label>
                  <Input
                    type="number"
                    value={variants[key].visitors || ''}
                    onChange={(e) => setVariants(prev => ({
                      ...prev,
                      [key]: { ...prev[key], visitors: Number(e.target.value) }
                    }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Conversions</Label>
                  <Input
                    type="number"
                    value={variants[key].conversions || ''}
                    onChange={(e) => setVariants(prev => ({
                      ...prev,
                      [key]: { ...prev[key], conversions: Number(e.target.value) }
                    }))}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Additional Test Pairs */}
          {Object.keys(variants).length > 2 && (
            <>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-medium">Additional Test Data</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(variants)
                  .filter(([key]) => !['control', 'variant'].includes(key))
                  .map(([key, variant]) => (
                    <div key={`additional-${key}`} className="space-y-4 relative">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-0 right-0"
                        onClick={() => {
                          const { [key]: _, ...rest } = variants
                          setVariants(rest)
                        }}
                      >
                        <Trash className="w-4 h-4" />
                      </Button>
                      <div className="space-y-2">
                        <Label>Version Name</Label>
                        <Input
                          value={variant.name}
                          onChange={(e) => setVariants(prev => ({
                            ...prev,
                            [key]: { ...prev[key], name: e.target.value }
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Visitors</Label>
                        <Input
                          type="number"
                          value={variant.visitors || ''}
                          onChange={(e) => setVariants(prev => ({
                            ...prev,
                            [key]: { ...prev[key], visitors: Number(e.target.value) }
                          }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Conversions</Label>
                        <Input
                          type="number"
                          value={variant.conversions || ''}
                          onChange={(e) => setVariants(prev => ({
                            ...prev,
                            [key]: { ...prev[key], conversions: Number(e.target.value) }
                          }))}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}

          {/* Add Test Pair Button */}
          {Object.keys(variants).length < 4 && (
            <div className="mt-6">
              <Button 
                variant="outline"
                onClick={() => {
                  const currentIndex = Math.floor(Object.keys(variants).length / 2)
                  setVariants(prev => ({
                    ...prev,
                    [`control${currentIndex}`]: { 
                      name: `Control ${currentIndex}`, 
                      visitors: 0, 
                      conversions: 0 
                    },
                    [`variant${currentIndex}`]: { 
                      name: `Variant ${currentIndex}`, 
                      visitors: 0, 
                      conversions: 0 
                    }
                  }))
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Test Pair
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {validateInputs().errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-medium mb-2">Please fix the following errors:</h3>
          <ul className="list-disc list-inside text-red-700 text-sm">
            {validateInputs().errors.map((error, index) => (
              <li key={`validation-error-${index}`}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}

      {calculateResults() && (
        <Card className="border-[#5e62d1]">
          <CardHeader className="flex flex-row justify-between items-center">
            <CardTitle className="text-[#5e62d1]">Revenue Impact Analysis</CardTitle>
            <Button variant="outline" onClick={exportToPDF}>
              <Download className="w-4 h-4 mr-2" />
              Export Results
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderAnalysis(calculateResults()!)}
            {renderChart(calculateResults()!)}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

