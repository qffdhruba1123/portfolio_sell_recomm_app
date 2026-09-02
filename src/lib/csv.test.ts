import { describe, expect, it } from 'vitest'
import type { Holding, Institution } from '../types'
import { buildCsvImportPlan, CSV_TEMPLATE_EXAMPLE_ROW, CSV_TEMPLATE_HEADER, parseCsv, parseCsvRows } from './csv'

describe('parseCsv', () => {
  it('parses simple comma-separated rows', () => {
    const rows = parseCsv('a,b,c\n1,2,3')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const rows = parseCsv('name,note\n"Regional Industrial AG","Bought at ""discount"", 2 lots"')
    expect(rows[1]).toEqual(['Regional Industrial AG', 'Bought at "discount", 2 lots'])
  })

  it('skips blank lines', () => {
    const rows = parseCsv('a,b\n1,2\n\n3,4\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })
})

describe('parseCsvRows', () => {
  it('parses the documented template header + example row cleanly', () => {
    const { rows, errors } = parseCsvRows(`${CSV_TEMPLATE_HEADER}\n${CSV_TEMPLATE_EXAMPLE_ROW}`)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      {
        identifier: 'US0378331005',
        displayName: 'Apple Inc.',
        securityType: 'STOCK',
        institutionLabel: 'Hauptbroker',
        acquiredAt: '2021-03-15',
        quantity: 10,
        unitCostEur: 120.5,
        note: 'Initial purchase',
      },
    ])
  })

  it('accepts alias column names case-insensitively', () => {
    const csv = 'ISIN,Name,Type,Broker,Date,Qty,Unit_Cost\nUS123,Test Co,etf,Broker A,2020-01-01,5,10'
    const { rows, errors } = parseCsvRows(csv)
    expect(errors).toEqual([])
    expect(rows[0].securityType).toBe('ETF')
    expect(rows[0].institutionLabel).toBe('Broker A')
  })

  it('reports a missing-column error and parses nothing', () => {
    const { rows, errors } = parseCsvRows('identifier,displayName\nX,Y')
    expect(rows).toEqual([])
    expect(errors[0].message).toMatch(/Missing required column/)
  })

  it('skips and reports a row with an invalid securityType instead of guessing', () => {
    const csv = `${CSV_TEMPLATE_HEADER}\nUS1,Foo,BOND,Broker A,2020-01-01,1,10,`
    const { rows, errors } = parseCsvRows(csv)
    expect(rows).toEqual([])
    expect(errors[0]).toMatchObject({ rowNumber: 2, message: expect.stringContaining('STOCK, ETF, or OTHER') })
  })

  it('skips and reports a row with a malformed date', () => {
    const csv = `${CSV_TEMPLATE_HEADER}\nUS1,Foo,STOCK,Broker A,15/03/2021,1,10,`
    const { errors } = parseCsvRows(csv)
    expect(errors[0].message).toMatch(/YYYY-MM-DD/)
  })

  it('continues parsing valid rows after a bad row', () => {
    const csv = [
      CSV_TEMPLATE_HEADER,
      'US1,Bad,BOND,Broker A,2020-01-01,1,10,',
      'US2,Good,STOCK,Broker A,2020-01-01,1,10,',
    ].join('\n')
    const { rows, errors } = parseCsvRows(csv)
    expect(errors).toHaveLength(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].identifier).toBe('US2')
  })
})

describe('buildCsvImportPlan', () => {
  it('groups multiple lot rows for the same identifier+institution into one new holding', () => {
    const csv = [
      CSV_TEMPLATE_HEADER,
      'US1,Test Co,STOCK,Broker A,2018-01-01,10,20,',
      'US1,Test Co,STOCK,Broker A,2021-01-01,5,50,',
    ].join('\n')
    const { rows } = parseCsvRows(csv)
    const plan = buildCsvImportPlan(rows, [], [])
    expect(plan.newHoldings).toHaveLength(1)
    expect(plan.newHoldings[0].lots).toHaveLength(2)
    expect(plan.newInstitutions).toEqual([{ label: 'Broker A', submittedEur: 0, usedEur: 0 }])
  })

  it('treats the same identifier at two different institutions as two separate holdings', () => {
    const csv = [
      CSV_TEMPLATE_HEADER,
      'US1,Test Co,STOCK,Broker A,2018-01-01,10,20,',
      'US1,Test Co,STOCK,Broker B,2018-01-01,10,20,',
    ].join('\n')
    const { rows } = parseCsvRows(csv)
    const plan = buildCsvImportPlan(rows, [], [])
    expect(plan.newHoldings).toHaveLength(2)
    expect(plan.newInstitutions).toHaveLength(2)
  })

  it('appends to an existing holding instead of creating a duplicate', () => {
    const institutions: Institution[] = [{ id: 'i1', label: 'Broker A', submittedEur: 0, usedEur: 0 }]
    const existingHoldings: Holding[] = [
      { id: 'h1', identifier: 'US1', displayName: 'Test Co', securityType: 'STOCK', institutionId: 'i1', lots: [] },
    ]
    const csv = `${CSV_TEMPLATE_HEADER}\nUS1,Test Co,STOCK,Broker A,2021-01-01,5,50,`
    const { rows } = parseCsvRows(csv)
    const plan = buildCsvImportPlan(rows, existingHoldings, institutions)
    expect(plan.newHoldings).toHaveLength(0)
    expect(plan.appendedLots).toEqual([{ holdingId: 'h1', lots: [{ acquiredAt: '2021-01-01', quantity: 5, unitCostEur: 50, note: undefined }] }])
    expect(plan.newInstitutions).toHaveLength(0)
  })

  it('does not propose creating an institution that already exists (case-insensitive)', () => {
    const institutions: Institution[] = [{ id: 'i1', label: 'broker a', submittedEur: 0, usedEur: 0 }]
    const csv = `${CSV_TEMPLATE_HEADER}\nUS1,Test Co,STOCK,Broker A,2021-01-01,5,50,`
    const { rows } = parseCsvRows(csv)
    const plan = buildCsvImportPlan(rows, [], institutions)
    expect(plan.newInstitutions).toHaveLength(0)
  })
})
