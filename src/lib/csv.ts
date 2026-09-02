import type { Holding, Institution, Lot, SecurityType } from '../types'

/** Minimal RFC4180-ish CSV parser: quoted fields, embedded commas, "" escaped quotes, CRLF/LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some((f) => f !== '')) rows.push(row)
  }
  return rows
}

const HEADER_ALIASES: Record<string, string[]> = {
  identifier: ['identifier', 'isin', 'ticker', 'symbol'],
  displayName: ['displayname', 'display_name', 'name'],
  securityType: ['securitytype', 'security_type', 'type'],
  institution: ['institution', 'institutionlabel', 'broker'],
  acquiredAt: ['acquiredat', 'acquired_at', 'date', 'acquireddate', 'acquired_date'],
  quantity: ['quantity', 'qty', 'units'],
  unitCostEur: ['unitcosteur', 'unitcost', 'unit_cost_eur', 'unit_cost', 'price'],
  note: ['note', 'notes'],
}

const REQUIRED_FIELDS = ['identifier', 'displayName', 'securityType', 'institution', 'acquiredAt', 'quantity', 'unitCostEur'] as const

export const CSV_TEMPLATE_HEADER = 'identifier,displayName,securityType,institution,acquiredAt,quantity,unitCostEur,note'
export const CSV_TEMPLATE_EXAMPLE_ROW = 'US0378331005,Apple Inc.,STOCK,Hauptbroker,2021-03-15,10,120.50,Initial purchase'

function resolveHeaderMap(headerRow: string[]): Record<string, number> {
  const normalized = headerRow.map((h) => h.trim().toLowerCase())
  const map: Record<string, number> = {}
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h))
    if (idx >= 0) map[canonical] = idx
  }
  return map
}

export interface CsvImportError {
  rowNumber: number // 1-based, counting the header as row 1
  message: string
}

export interface CsvImportSummary {
  holdingsCreated: number
  holdingsAppended: number
  lotsAdded: number
  institutionsCreated: number
  errors: CsvImportError[]
}

interface CsvLotRow {
  identifier: string
  displayName: string
  securityType: SecurityType
  institutionLabel: string
  acquiredAt: string
  quantity: number
  unitCostEur: number
  note?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseSecurityType(raw: string): SecurityType | null {
  const upper = raw.trim().toUpperCase()
  if (upper === 'STOCK' || upper === 'ETF' || upper === 'OTHER') return upper
  return null
}

/**
 * Parses and validates rows; does not touch app state. Returns clean rows plus
 * per-row errors so a bad row is skipped and reported, never silently guessed.
 */
export function parseCsvRows(text: string): { rows: CsvLotRow[]; errors: CsvImportError[] } {
  const table = parseCsv(text)
  const rows: CsvLotRow[] = []
  const errors: CsvImportError[] = []
  if (table.length === 0) return { rows, errors: [{ rowNumber: 1, message: 'File is empty.' }] }

  const headerMap = resolveHeaderMap(table[0])
  const missing = REQUIRED_FIELDS.filter((f) => !(f in headerMap))
  if (missing.length > 0) {
    return { rows, errors: [{ rowNumber: 1, message: `Missing required column(s): ${missing.join(', ')}.` }] }
  }

  for (let i = 1; i < table.length; i++) {
    const rowNumber = i + 1
    const cells = table[i]
    const get = (field: string) => cells[headerMap[field]]?.trim() ?? ''

    const identifier = get('identifier')
    const displayName = get('displayName')
    const securityTypeRaw = get('securityType')
    const institutionLabel = get('institution')
    const acquiredAt = get('acquiredAt')
    const quantityRaw = get('quantity')
    const unitCostRaw = get('unitCostEur')
    const note = headerMap.note != null ? get('note') : undefined

    if (!identifier || !displayName || !institutionLabel || !acquiredAt || !quantityRaw || !unitCostRaw) {
      errors.push({ rowNumber, message: 'Missing a required value.' })
      continue
    }
    const securityType = parseSecurityType(securityTypeRaw)
    if (!securityType) {
      errors.push({ rowNumber, message: `securityType must be STOCK, ETF, or OTHER (got "${securityTypeRaw}").` })
      continue
    }
    if (!DATE_RE.test(acquiredAt)) {
      errors.push({ rowNumber, message: `acquiredAt must be YYYY-MM-DD (got "${acquiredAt}").` })
      continue
    }
    const quantity = Number(quantityRaw)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push({ rowNumber, message: `quantity must be a positive number (got "${quantityRaw}").` })
      continue
    }
    const unitCostEur = Number(unitCostRaw)
    if (!Number.isFinite(unitCostEur) || unitCostEur < 0) {
      errors.push({ rowNumber, message: `unitCostEur must be a non-negative number (got "${unitCostRaw}").` })
      continue
    }

    rows.push({ identifier, displayName, securityType, institutionLabel, acquiredAt, quantity, unitCostEur, note: note || undefined })
  }

  return { rows, errors }
}

export interface CsvImportPlan {
  newInstitutions: Omit<Institution, 'id'>[]
  /** Keyed by a synthetic key so applyCsvImportPlan can look up the resolved institution id. */
  institutionKeyToLabel: Record<string, string>
  newHoldings: { key: string; holding: Omit<Holding, 'id' | 'lots' | 'institutionId'>; institutionKey: string; lots: Omit<Lot, 'id'>[] }[]
  appendedLots: { holdingId: string; lots: Omit<Lot, 'id'>[] }[]
  summary: CsvImportSummary
}

/**
 * Groups validated rows into new/append operations without mutating state.
 * A (identifier, institution) pair is one holding — the same security held at
 * two different institutions is intentionally two separate holdings, since tax
 * and allowance tracking are per-institution.
 */
export function buildCsvImportPlan(rows: CsvLotRow[], existingHoldings: Holding[], existingInstitutions: Institution[]): CsvImportPlan {
  const institutionByLabel = new Map(existingInstitutions.map((i) => [i.label.trim().toLowerCase(), i]))
  const newInstitutionLabels = new Map<string, string>() // lowercase -> original-case label

  const holdingByKey = new Map<string, Holding>()
  for (const h of existingHoldings) {
    const inst = existingInstitutions.find((i) => i.id === h.institutionId)
    if (inst) holdingByKey.set(`${h.identifier.trim().toLowerCase()}::${inst.label.trim().toLowerCase()}`, h)
  }

  const newHoldingsByKey = new Map<string, CsvImportPlan['newHoldings'][number]>()
  const appendedByHoldingId = new Map<string, Omit<Lot, 'id'>[]>()

  for (const row of rows) {
    const instKey = row.institutionLabel.trim().toLowerCase()
    const holdingKey = `${row.identifier.trim().toLowerCase()}::${instKey}`
    const lot: Omit<Lot, 'id'> = { acquiredAt: row.acquiredAt, quantity: row.quantity, unitCostEur: row.unitCostEur, note: row.note }

    const existingHolding = holdingByKey.get(holdingKey)
    if (existingHolding) {
      const list = appendedByHoldingId.get(existingHolding.id) ?? []
      list.push(lot)
      appendedByHoldingId.set(existingHolding.id, list)
      continue
    }

    if (!institutionByLabel.has(instKey) && !newInstitutionLabels.has(instKey)) {
      newInstitutionLabels.set(instKey, row.institutionLabel.trim())
    }

    const existingPlanned = newHoldingsByKey.get(holdingKey)
    if (existingPlanned) {
      existingPlanned.lots.push(lot)
    } else {
      newHoldingsByKey.set(holdingKey, {
        key: holdingKey,
        holding: { identifier: row.identifier.trim(), displayName: row.displayName.trim(), securityType: row.securityType },
        institutionKey: instKey,
        lots: [lot],
      })
    }
  }

  return {
    newInstitutions: [...newInstitutionLabels.values()].map((label) => ({ label, submittedEur: 0, usedEur: 0 })),
    institutionKeyToLabel: Object.fromEntries(newInstitutionLabels.entries()),
    newHoldings: [...newHoldingsByKey.values()],
    appendedLots: [...appendedByHoldingId.entries()].map(([holdingId, lots]) => ({ holdingId, lots })),
    summary: {
      holdingsCreated: newHoldingsByKey.size,
      holdingsAppended: appendedByHoldingId.size,
      lotsAdded: rows.length,
      institutionsCreated: newInstitutionLabels.size,
      errors: [],
    },
  }
}

export { type CsvLotRow }
