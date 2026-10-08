'use client';
import {useEffect, useRef, useState} from 'react';
import {catalogLimits, catalogReviewTemplate, reviewCatalogFile, type CatalogReview} from '../shared/food-catalog-review';

export function FoodCatalogReview({disabled}: {disabled: boolean}) {
  const [review, setReview] = useState<CatalogReview | null>(null), [filename, setFilename] = useState(''), [error, setError] = useState(''), [reading, setReading] = useState(false);
  const generation = useRef(0), input = useRef<HTMLInputElement>(null);
  useEffect(() => () => {generation.current++}, []);
  const clear = () => {generation.current++; setReview(null); setFilename(''); setError(''); setReading(false); if (input.current) input.current.value = ''};
  return <details className="food-card"><summary>Review a shared catalog file</summary>
    <p>This separate review checks restaurant links, supplier packs and recipe units in a normalized shared catalog. It reads the selected file in this browser; it does not connect, import or save records.</p>
    <p>Use the review template with the seven catalog tables. An individual Supabase table export or Jeff’s original JSON export is a different format. Exclude people, invoices, credentials and other operating records.</p>
    <a download="JMAX-Shared-Catalog-Review-Template.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(catalogReviewTemplate())}`}>Download empty review template</a>
    <fieldset disabled={disabled}><label className="shared-field">Shared catalog review file<input ref={input} type="file" accept=".json,application/json" onChange={async e => {
      const file = e.target.files?.[0], request = ++generation.current; setReview(null); setFilename(''); setError(''); setReading(!!file);
      if (!file) return;
      try {
        if (file.size > catalogLimits.bytes) throw new Error('Use a catalog review file no larger than 5 MB.');
        const raw = await file.text(); if (generation.current !== request) return;
        const next = reviewCatalogFile(raw); setReview(next); setFilename(file.name);
      } catch (err) {if (generation.current === request) setError(err instanceof Error ? err.message : 'Cannot read catalog file.')}
      finally {if (generation.current === request) setReading(false)}
    }}/></label><button type="button" onClick={clear}>Clear file review</button></fieldset>
    {reading && <p role="status">Reading this file…</p>}{error && <p className="food-warning" role="alert">{error}</p>}
    {review && <section aria-label="Shared catalog file findings">
      <h3>File reviewed: {filename}</h3>
      <p>Source claims: {review.source.label} · {review.source.projectRef} · {review.source.dataset} · {review.source.scope}. Declared export time: {review.source.exportedAt}.</p>
      <p role="status"><strong>{review.rows} rows checked · {review.errors} structural issues · {review.reviews} source or integration checks.</strong></p>
      <p className="food-warning">This is a file review, not approval to connect. Live access, source completeness and the shared backend remain unverified by this check. Stock balances and explicit recipe measures are not converted into counts or portions.</p>
      <details><summary>Rows in each table</summary><ul>{Object.entries(review.counts).map(([name, count]) => <li key={name}>{name}: {count}</li>)}</ul></details>
      <h4>Restaurant references in this file</h4>
      {review.stores.length === 0 ? <p>No unambiguous restaurant records.</p> : <ul>{review.stores.map(s => <li key={s.id}><strong>{s.name} ({s.id})</strong>: {s.items} item links, {s.recipes} recipes, {s.standingPrep} standing prep rows. Source commissary flag: {s.usesCommissary === null ? 'missing' : s.usesCommissary ? 'yes' : 'no'}.</li>)}</ul>}
      <p>Counts include inactive rows. Identifiers remain exact; names and code prefixes never select a restaurant.</p>
      <h4>Findings</h4><ol>{review.findings.map((f, i) => <li key={i}><strong>{f.severity === 'error' ? 'Fix' : 'Review'} · {f.path}</strong>: {f.message}</li>)}</ol>
      {review.omittedFindings > 0 && <p>{review.omittedFindings} additional findings omitted from this screen. All {review.rows} rows were checked; fix the first findings and review the file again.</p>}
    </section>}
  </details>;
}
