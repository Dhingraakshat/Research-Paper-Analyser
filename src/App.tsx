/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { analyzeAbstracts, analyzePDF } from './services/gemini';
import Markdown from 'react-markdown';
import Papa from 'papaparse';
import { 
  FileText, 
  Send, 
  Loader2, 
  Table as TableIcon, 
  AlertCircle, 
  Clipboard, 
  CheckCircle2, 
  Trash2, 
  Settings2, 
  Upload, 
  FileSpreadsheet, 
  Download,
  File as FileIcon,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface QueuedFile {
  file: File;
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
}

export default function App() {
  const [userPrompt, setUserPrompt] = useState('Enter your prompt here');
  const [input, setInput] = useState('');
  const [pdfFiles, setPdfFiles] = useState<QueuedFile[]>([]);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'text' | 'pdf'>('text');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const paperCount = input.split(/ID \d+:/g).filter(s => s.trim()).length;
  const charCount = input.length;

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleAnalyze = async () => {
    if (mode === 'text' && !input.trim()) return;
    if (mode === 'pdf' && pdfFiles.length === 0) return;
    
    setLoading(true);
    setError(null);
    setResult('');

    const tableLines = userPrompt.split('\n').filter(l => l.includes('|') && l.includes('---'));
    const tableHeader = tableLines.length > 0 ? tableLines[0] : '| Study ID | Paper title | Data |\n|---|---|---|';
    let accumulatedResult = tableHeader;

    try {
      if (mode === 'text') {
        const papers = input.split(/(?=ID \d+:)/g).filter(s => s.trim());
        const totalPapers = papers.length;
        const batchSize = 10;
        setProgress({ current: 0, total: totalPapers });

        for (let i = 0; i < totalPapers; i += batchSize) {
          const batch = papers.slice(i, i + batchSize);
          const batchText = batch.join('\n\n');
          setProgress({ current: i, total: totalPapers });
          
          const analysis = await analyzeAbstracts(batchText, userPrompt);
          const rows = analysis.split('\n')
            .filter(line => line.trim().startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('study id'))
            .join('\n');

          accumulatedResult += '\n' + rows;
          setResult(accumulatedResult);
          
          const completed = Math.min(i + batchSize, totalPapers);
          setProgress({ current: completed, total: totalPapers });

          if (completed < totalPapers) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      } else {
        const total = pdfFiles.length;
        setProgress({ current: 0, total });
        
        for (let i = 0; i < total; i++) {
          const queuedFile = pdfFiles[i];
          setPdfFiles(prev => prev.map(f => f.id === queuedFile.id ? { ...f, status: 'processing' } : f));
          setProgress({ current: i + 1, total });

          try {
            const base64 = await fileToBase64(queuedFile.file);
            const analysis = await analyzePDF(base64, queuedFile.file.name, userPrompt);
            
            const rows = analysis.split('\n')
              .filter(line => line.trim().startsWith('|') && !line.includes('---') && !line.toLowerCase().includes('study id'))
              .join('\n');

            accumulatedResult += '\n' + rows;
            setResult(accumulatedResult);
            setPdfFiles(prev => prev.map(f => f.id === queuedFile.id ? { ...f, status: 'completed' } : f));
          } catch (err) {
            setPdfFiles(prev => prev.map(f => f.id === queuedFile.id ? { ...f, status: 'error' } : f));
            throw err;
          }

          if (i < total - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred during processing');
    } finally {
      setLoading(false);
    }
  };

  const handlePdfUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const newFiles: QueuedFile[] = files.map(file => ({
      file,
      id: Math.random().toString(36).substring(7),
      status: 'queued'
    }));
    setPdfFiles(prev => [...prev, ...newFiles]);
    setMode('pdf');
    if (pdfInputRef.current) pdfInputRef.current.value = '';
  };

  const removePdf = (id: string) => {
    setPdfFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const formattedText = results.data
          .map((row: any, index: number) => {
            const id = row.id || row.ID || row.Id || (index + 1);
            const title = row.title || row.Title || row.name || row.Name || '';
            const abstract = row.abstract || row.Abstract || row.description || row.Description || '';
            if (!title && !abstract) return null;
            return `ID ${id}: Title: ${title}\nAbstract: ${abstract}`;
          })
          .filter(Boolean)
          .join('\n\n');

        if (formattedText) {
          setInput(formattedText);
          setMode('text');
          setError(null);
        } else {
          setError('Could not find recognizable columns (ID, Title, Abstract) in the CSV.');
        }
      },
      error: (err) => {
        setError(`Error parsing CSV: ${err.message}`);
      }
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const parseMarkdownTable = (markdown: string) => {
    const lines = markdown.trim().split('\n');
    const tableLines = lines.filter(line => line.trim().startsWith('|') && line.trim().endsWith('|'));
    const dataLines = tableLines.filter(line => !line.includes('---'));
    if (dataLines.length < 2) return null;

    const headers = dataLines[0].split('|').map(h => h.trim()).filter(h => h !== '');
    const rows = dataLines.slice(1).map(line => {
      const cells = line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] || '';
      });
      return row;
    });
    return rows;
  };

  const downloadCSV = () => {
    const data = parseMarkdownTable(result);
    if (!data) {
      setError('Could not parse the analysis result into a CSV format.');
      return;
    }
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `mddoai_analysis_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const clearAll = () => {
    setInput('');
    setPdfFiles([]);
    setResult('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-indigo-100">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-200">
              <TableIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Analyze SLR</h1>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Automated Research Extraction Tool</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200 mr-4">
              <button 
                onClick={() => setMode('text')}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                  mode === 'text' ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
                )}
              >
                Text/CSV
              </button>
              <button 
                onClick={() => setMode('pdf')}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                  mode === 'pdf' ? "bg-white shadow-sm text-indigo-600" : "text-gray-500 hover:text-gray-700"
                )}
              >
                PDF Files
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-88px)]">
        <section className="flex flex-col gap-6 h-full overflow-hidden">
          {/* Step 1: System Prompt */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                <h2 className="font-semibold text-gray-700">System Prompt</h2>
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="Define your research questions and output format..."
                className="w-full h-32 p-4 transition-all resize-none font-mono text-xs leading-relaxed placeholder:text-gray-300 outline-none"
              />
            </div>
          </div>

          {/* Step 2: Papers */}
          <div className="flex flex-col gap-3 flex-1 overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                <h2 className="font-semibold text-gray-700">Papers</h2>
                {mode === 'text' && paperCount > 0 && (
                  <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-indigo-100 uppercase tracking-wider">
                    {paperCount} {paperCount === 1 ? 'Paper' : 'Papers'}
                  </span>
                )}
                {mode === 'pdf' && pdfFiles.length > 0 && (
                  <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-md border border-indigo-100 uppercase tracking-wider">
                    {pdfFiles.length} {pdfFiles.length === 1 ? 'File' : 'Files'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {mode === 'text' ? (
                  <>
                    <input type="file" accept=".csv" onChange={handleFileUpload} ref={fileInputRef} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-100 uppercase tracking-tight">
                      <Upload className="w-3 h-3" /> Upload CSV
                    </button>
                  </>
                ) : (
                  <>
                    <input type="file" accept=".pdf" multiple onChange={handlePdfUpload} ref={pdfInputRef} className="hidden" />
                    <button onClick={() => pdfInputRef.current?.click()} className="text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-100 uppercase tracking-tight">
                      <Upload className="w-3 h-3" /> Add PDFs
                    </button>
                  </>
                )}
                <button onClick={clearAll} className="text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1 uppercase tracking-tight">
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              </div>
            </div>
            
            <div className="relative flex-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
              {mode === 'text' ? (
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste abstracts here or upload a CSV..."
                  className="flex-1 w-full p-4 transition-all resize-none font-mono text-xs leading-relaxed placeholder:text-gray-300 outline-none"
                />
              ) : (
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {pdfFiles.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                      <Upload className="w-10 h-10 mb-2 opacity-20" />
                      <p className="text-xs font-medium">No PDF files added</p>
                    </div>
                  ) : (
                    pdfFiles.map((f) => (
                      <div key={f.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100 group">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <div className={cn(
                            "p-1.5 rounded-md",
                            f.status === 'completed' ? "bg-emerald-100 text-emerald-600" : 
                            f.status === 'error' ? "bg-red-100 text-red-600" : 
                            f.status === 'processing' ? "bg-indigo-100 text-indigo-600" : "bg-gray-200 text-gray-500"
                          )}>
                            {f.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileIcon className="w-3 h-3" />}
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-[10px] font-semibold truncate">{f.file.name}</p>
                            <p className="text-[8px] text-gray-400 uppercase font-bold tracking-tighter">{(f.file.size / 1024 / 1024).toFixed(2)} MB • {f.status}</p>
                          </div>
                        </div>
                        <button onClick={() => removePdf(f.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
              <div className="p-3 border-t border-gray-100 bg-gray-50/50">
                <button
                  onClick={handleAnalyze}
                  disabled={loading || (mode === 'text' ? !input.trim() : pdfFiles.length === 0)}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-lg uppercase tracking-widest",
                    loading || (mode === 'text' ? !input.trim() : pdfFiles.length === 0)
                      ? "bg-gray-100 text-gray-400 cursor-not-allowed shadow-none" 
                      : "bg-indigo-600 text-white hover:bg-indigo-700 hover:-translate-y-0.5 active:translate-y-0 shadow-indigo-200"
                  )}
                >
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><Send className="w-4 h-4" /> Run Analysis</>}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4 h-full overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TableIcon className="w-5 h-5 text-indigo-600" />
              <h2 className="font-semibold text-gray-700">Extracted Data</h2>
            </div>
            {result && (
              <div className="flex items-center gap-2">
                <button onClick={downloadCSV} className="text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                  <Download className="w-3 h-3" /> Download CSV
                </button>
                <button onClick={copyToClipboard} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors flex items-center gap-1 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100">
                  {copied ? <><CheckCircle2 className="w-3 h-3" /> Copied!</> : <><Clipboard className="w-3 h-3" /> Copy Markdown</>}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-auto relative">
            <AnimatePresence mode="wait">
              {!result && !loading && !error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                    <FileSpreadsheet className="w-8 h-8 text-gray-300" />
                  </div>
                  <h3 className="text-gray-400 font-medium">No data analyzed yet</h3>
                  <p className="text-sm text-gray-300 max-w-[240px] mt-2">Upload PDFs or paste abstracts to generate the SLR table.</p>
                </motion.div>
              )}

              {loading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm z-10">
                  <div className="relative flex items-center justify-center mb-6">
                    <Loader2 className="w-16 h-16 text-indigo-600 animate-spin" />
                    <div className="absolute text-[10px] font-bold text-indigo-600">{Math.round((progress.current / progress.total) * 100)}%</div>
                  </div>
                  <p className="text-sm font-bold text-gray-700 mb-1">Processing {mode === 'text' ? 'Papers' : 'PDFs'}</p>
                  <p className="text-xs text-gray-500 font-medium">{progress.current} of {progress.total} completed</p>
                  <div className="w-48 h-1.5 bg-gray-100 rounded-full mt-4 overflow-hidden border border-gray-200">
                    <motion.div className="h-full bg-indigo-600" initial={{ width: 0 }} animate={{ width: `${(progress.current / progress.total) * 100}%` }} transition={{ duration: 0.3 }} />
                  </div>
                </motion.div>
              )}

              {error && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-8">
                  <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl text-red-700">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div><h4 className="font-bold text-sm">Analysis Failed</h4><p className="text-xs mt-1 opacity-90">{error}</p></div>
                  </div>
                </motion.div>
              )}

              {result && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-6 prose prose-sm max-w-none prose-indigo prose-table:border prose-table:border-gray-200 prose-th:bg-gray-50 prose-th:p-3 prose-td:p-3 prose-th:text-xs prose-th:uppercase prose-th:tracking-wider prose-td:text-xs">
                  <Markdown>{result}</Markdown>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 text-[10px] text-gray-400 flex justify-between items-center">
      </footer>
    </div>
  );
}
