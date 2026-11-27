'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type UploadResult = {
  success?: boolean;
  exam_name?: string;
  year?: number;
  pages?: number;
  extracted_characters?: number;
  questions_detected?: number;
  rows_inserted?: number;
  remaining_unprocessed?: number;
  message?: string;
  error?: string;
};

export default function PyqPipelinePage() {
  const [examName, setExamName] = useState('');
  const [year, setYear] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(true);
  const [countError, setCountError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshRemaining = useCallback(async () => {
    setCountLoading(true);
    setCountError('');
    const { count, error } = await supabase
      .from('pyq_raw')
      .select('id', { count: 'exact', head: true })
      .eq('processed', false);

    if (error) {
      setCountError(error.message);
      setRemaining(null);
    } else {
      setRemaining(count ?? 0);
    }
    setCountLoading(false);
  }, []);

  useEffect(() => {
    void refreshRemaining();
  }, [refreshRemaining]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError('');
    setUploadResult(null);

    if (!examName.trim()) {
      setUploadError('Enter the exam name.');
      return;
    }
    if (!/^\d{4}$/.test(year)) {
      setUploadError('Enter a valid four-digit exam year.');
      return;
    }
    if (!file) {
      setUploadError('Choose a PDF file first.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('The PDF must be 20 MB or smaller.');
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are accepted.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('exam_name', examName.trim());
      formData.append('year', year);

      const { data, error } = await supabase.functions.invoke<UploadResult>('extract-pyq-pdf', {
        body: formData,
      });

      if (error) {
        let message = error.message || 'PDF upload failed.';
        try {
          const context = (error as any).context;
          if (context && typeof context.json === 'function') {
            const details = await context.json();
            if (details?.error) message = details.error;
          }
        } catch {
          // Keep the function client's error message when the response is not JSON.
        }
        throw new Error(message);
      }
      if (!data?.success) throw new Error(data?.error || 'The extraction function did not confirm success.');

      setUploadResult(data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refreshRemaining();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unexpected upload error.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1500px] p-4 text-slate-800 md:p-8">
      <header className="mb-7">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700">
          <span className="rounded-full bg-blue-100 px-3 py-1">PYQ WORKFLOW</span>
          <span className="text-slate-400">/</span>
          <span className="text-slate-500">PDF extraction & batch processing</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-slate-900">PYQ PDF Pipeline</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Upload a previous-year question paper to extract question-wise raw text. Review the
          unprocessed queue below before running the separate five-question AI processing step.
        </p>
      </header>

      <section className="mb-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">Step 1</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Upload question paper</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            PDF · Max 20 MB
          </span>
        </div>

        <form onSubmit={handleUpload} className="grid gap-5 p-5 md:grid-cols-2 md:p-7">
          <div>
            <label htmlFor="exam-name" className="mb-2 block text-sm font-semibold text-slate-700">
              Exam name
            </label>
            <input
              id="exam-name"
              value={examName}
              onChange={(event) => setExamName(event.target.value)}
              placeholder="e.g. SSC CHSL"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              required
            />
          </div>

          <div>
            <label htmlFor="exam-year" className="mb-2 block text-sm font-semibold text-slate-700">
              Exam year
            </label>
            <input
              id="exam-year"
              type="number"
              min="1990"
              max="2100"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="e.g. 2025"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              required
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="pyq-file" className="mb-2 block text-sm font-semibold text-slate-700">
              Select PDF file
            </label>
            <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 transition hover:border-blue-400 hover:bg-blue-50/40">
              <input
                ref={fileInputRef}
                id="pyq-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full cursor-pointer text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-100 file:px-4 file:py-2.5 file:font-semibold file:text-blue-800 hover:file:bg-blue-200"
                required
              />
              {file && (
                <p className="mt-3 text-xs text-slate-500">
                  Selected: <span className="font-semibold text-slate-700">{file.name}</span>
                  {' · '}{(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              )}
            </div>
          </div>

          {uploadError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-2">
              {uploadError}
            </div>
          )}

          {uploadResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 md:col-span-2">
              <p className="font-bold text-emerald-900">PDF extracted and saved to pyq_raw</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div><p className="text-emerald-700">Pages</p><p className="text-xl font-bold text-emerald-950">{uploadResult.pages ?? '—'}</p></div>
                <div><p className="text-emerald-700">Questions detected</p><p className="text-xl font-bold text-emerald-950">{uploadResult.questions_detected ?? '—'}</p></div>
                <div><p className="text-emerald-700">Rows inserted</p><p className="text-xl font-bold text-emerald-950">{uploadResult.rows_inserted ?? '—'}</p></div>
                <div><p className="text-emerald-700">Characters extracted</p><p className="text-xl font-bold text-emerald-950">{(uploadResult.extracted_characters ?? 0).toLocaleString()}</p></div>
              </div>
              <p className="mt-3 text-xs text-emerald-800">{uploadResult.message}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
            <p className="max-w-xl text-xs leading-5 text-slate-500">
              This step only extracts selectable PDF text and stores question chunks. It does not
              call Groq, run OCR, or insert into previous_year_questions.
            </p>
            <button
              type="submit"
              disabled={uploading || !file || !examName.trim() || !/^\d{4}$/.test(year)}
              className="inline-flex min-w-44 items-center justify-center rounded-xl bg-blue-700 px-6 py-3 font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {uploading ? 'Extracting PDF…' : 'Upload & extract PDF'}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 md:px-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-violet-700">Step 2</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">AI batch processing</h2>
            <p className="mt-1 text-sm text-slate-500">Reserved for Edge Function 2 · Manual batches of five</p>
          </div>
          <div className="min-w-36 rounded-xl bg-slate-50 px-4 py-3 text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unprocessed</p>
            <p className="text-3xl font-black tabular-nums text-slate-900">
              {countLoading ? '…' : remaining === null ? '—' : remaining.toLocaleString()}
            </p>
            <button type="button" onClick={() => void refreshRemaining()} disabled={countLoading} className="mt-1 text-xs font-semibold text-blue-700 hover:underline disabled:text-slate-400">
              Refresh count
            </button>
          </div>
        </div>

        <div className="p-5 md:p-7">
          {countError && (
            <p role="alert" className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Could not load the pyq_raw queue count: {countError}
            </p>
          )}
          <div className="rounded-xl border border-dashed border-violet-200 bg-violet-50/60 p-5 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="max-w-2xl">
                <h3 className="font-bold text-slate-900">Process next 5 questions</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  The next function will select up to five rows where <code className="rounded bg-white px-1.5 py-0.5 text-xs">processed = false</code>,
                  send them for structured extraction, and import only the approved five fields into the existing PYQ table.
                </p>
              </div>
              <button
                type="button"
                disabled
                className="shrink-0 cursor-not-allowed rounded-xl bg-slate-300 px-5 py-3 text-sm font-bold text-slate-600"
                title="This button will be enabled after Edge Function 2 is built."
              >
                Function 2 not connected
              </button>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-5">
              {['Question 1', 'Question 2', 'Question 3', 'Question 4', 'Question 5'].map((label) => (
                <div key={label} className="rounded-lg border border-violet-100 bg-white px-3 py-3 text-center">
                  <div className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">—</div>
                  <p className="text-xs font-semibold text-slate-500">{label}</p>
                  <p className="mt-1 text-[11px] text-slate-400">Waiting</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              After each batch completes, this area will show the five question statuses and the button will become available for the next batch.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
