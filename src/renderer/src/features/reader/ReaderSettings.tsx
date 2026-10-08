/**
 * 页面设置（Popover）：EPUB / TXT 只有字号 16–24、行高 1.4–1.9、页边距（窄 / 中 / 宽）、单页 / 双页、原书版式 / 统一版式；
 * PDF 只有缩放（适合宽度 / 适合页面 / 75%–200%）和单页 / 双页。每本书各记一份。
 */
import type { ReactElement } from 'react'
import type { MarginSize } from '@shared/domain/pagination'
import { Popover, SegmentedControl } from '../../components/ui'
import { PREF_LIMITS, ZOOM_STEPS, type LayoutMode, type ReaderPrefs, type Spread } from './prefs'

function Slider({
  label,
  value,
  display,
  limits,
  onChange
}: {
  label: string
  value: number
  display: string
  limits: { min: number; max: number; step: number }
  onChange: (v: number) => void
}): ReactElement {
  return (
    <label className="aa-row">
      <span className="aa-label">{label}</span>
      <input
        type="range"
        className="aa-range"
        aria-label={label}
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="aa-value num">{display}</span>
    </label>
  )
}

function Row({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="aa-row">
      <span className="aa-label">{label}</span>
      {children}
    </div>
  )
}

export function ReaderSettings({
  anchor,
  open,
  prefs,
  pdf = false,
  doubleAvailable,
  onChange,
  onClose
}: {
  anchor: Element | null
  open: boolean
  prefs: ReaderPrefs
  pdf?: boolean
  /** 窗口够宽（≥ 1100px）才能双页 */
  doubleAvailable: boolean
  onChange: (p: ReaderPrefs) => void
  onClose: () => void
}): ReactElement | null {
  const spread = (
    <Row label="页面">
      <SegmentedControl<Spread>
        label="单页 / 双页"
        value={doubleAvailable ? prefs.spread : 'single'}
        onChange={(v) => onChange({ ...prefs, spread: v })}
        options={[
          { value: 'single', label: '单页' },
          { value: 'double', label: doubleAvailable ? '双页' : '双页（窗口太窄）' }
        ]}
      />
    </Row>
  )
  return (
    <Popover
      anchor={anchor}
      open={open}
      onClose={onClose}
      placement="bottom-end"
      label="页面设置"
      className="aa-panel"
    >
      <h2 className="popover-title">页面设置</h2>
      {pdf ? (
        <>
          <Row label="缩放">
            <SegmentedControl<string>
              label="缩放"
              value={String(prefs.zoom)}
              onChange={(v) =>
                onChange({ ...prefs, zoom: v === 'width' || v === 'page' ? v : Number(v) })
              }
              options={[
                { value: 'width', label: '适合宽度' },
                { value: 'page', label: '适合页面' }
              ]}
            />
          </Row>
          <Row label="比例">
            <SegmentedControl<string>
              label="缩放比例"
              value={String(prefs.zoom)}
              onChange={(v) => onChange({ ...prefs, zoom: Number(v) })}
              options={ZOOM_STEPS.map((z) => ({
                value: String(z),
                label: `${Math.round(z * 100)}%`
              }))}
            />
          </Row>
          {spread}
        </>
      ) : (
        <>
          <Slider
            label="字号"
            value={prefs.fontSize}
            display={`${prefs.fontSize}`}
            limits={PREF_LIMITS.fontSize}
            onChange={(fontSize) => onChange({ ...prefs, fontSize })}
          />
          <Slider
            label="行高"
            value={prefs.lineHeight}
            display={prefs.lineHeight.toFixed(2)}
            limits={PREF_LIMITS.lineHeight}
            onChange={(lineHeight) => onChange({ ...prefs, lineHeight })}
          />
          <Row label="页边距">
            <SegmentedControl<MarginSize>
              label="页边距"
              value={prefs.margin}
              onChange={(margin) => onChange({ ...prefs, margin })}
              options={[
                { value: 'narrow', label: '窄' },
                { value: 'medium', label: '中' },
                { value: 'wide', label: '宽' }
              ]}
            />
          </Row>
          {spread}
          <Row label="版式">
            <SegmentedControl<LayoutMode>
              label="版式"
              value={prefs.layout}
              onChange={(layout) => onChange({ ...prefs, layout })}
              options={[
                { value: 'original', label: '原书版式' },
                { value: 'unified', label: '统一版式' }
              ]}
            />
          </Row>
        </>
      )}
    </Popover>
  )
}
