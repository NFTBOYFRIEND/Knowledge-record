'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function SingleUnitStudio() {
  // Master Filtered Data (Only items with 0 records)
  const [allSubjects, setAllSubjects] = useState<any[]>([]);
  const [allTopics, setAllTopics] = useState<any[]>([]);
  const [allSubtopics, setAllSubtopics] = useState<any[]>([]);
  const [allUnits, setAllUnits] = useState<any[]>([]);

  // Active Dropdown Options
  const [activeSubjects, setActiveSubjects] = useState<any[]>([]);
  const [activeTopics, setActiveTopics] = useState<any[]>([]);
  const [activeSubtopics, setActiveSubtopics] = useState<any[]>([]);
  const [activeUnits, setActiveUnits] = useState<any[]>([]);

  // Selection States
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [subtopicId, setSubtopicId] = useState('');
  const [unitId, setUnitId] = useState('');

  // Passage & Processing States
  const [passage, setPassage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AI Proposed States
  const [proposedRecords, setProposedRecords] = useState<any[]>([]);
  const [proposedPatterns, setProposedPatterns] = useState<any[]>([]);
  const [proposedProfiles, setProposedProfiles] = useState<any[]>([]);

  async function fetchPendencyTree() {
    setLoadingTree(true);
    try {
      // 1. Fetch entire structure in parallel
      const [krRes, uRes, stRes, tRes, sRes] = await Promise.all([
        supabase.from('knowledge_records').select('learning_unit_id'),
        supabase.from('learning_units').select('id, name, subtopic_id').order('sequence'),
        supabase.from('subtopics').select('id, name, topic_id').order('sequence'),
        supabase.from('topics').select('id, name, subject_id').order('sequence'),
        supabase.from('subjects').select('id, name').order('name')
      ]);

      if (sRes.error) throw sRes.error;

      // 2. Identify all units that ALREADY have records
      const occupiedIds = new Set(krRes.data?.map(r => r.learning_unit_id) || []);

      // 3. Filter units to ONLY include empty ones
      const emptyUnits = (uRes.data || []).filter(u => !occupiedIds.has(u.id));
      const validSubtopicIds = new Set(emptyUnits.map(u => u.subtopic_id));

      // 4. Filter Subtopics (Must contain at least 1 empty unit)
      const validSubtopics = (stRes.data || []).filter(s => validSubtopicIds.has(s.id));
      const validTopicIds = new Set(validSubtopics.map(s => s.topic_id));

      // 5. Filter Topics (Must contain at least 1 valid subtopic)
      const validTopics = (tRes.data || []).filter(t => validTopicIds.has(t.id));
      const validSubjectIds = new Set(validTopics.map(t => t.subject_id));

      // 6. Filter Subjects (Must contain at least 1 valid topic)
      const validSubjects = (sRes.data || []).filter(s => validSubjectIds.has(s.id));

      setAllSubjects(validSubjects);
      setAllTopics(validTopics);
      setAllSubtopics(validSubtopics);
      setAllUnits(emptyUnits);

      setActiveSubjects(validSubjects);

      // Reset downstream selections if they became invalid
      if (!validTopicIds.has(topicId)) setTopicId('');
      if (!validSubtopicIds.has(subtopicId)) setSubtopicId('');
      if (!emptyUnits.find(u => u.id === unitId)) setUnitId('');

    } catch (err: any) {
      setError(`Error loading curriculum: ${err.message}`);
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    fetchPendencyTree();
  }, []);

  // Cascading Dropdown Logic
  useEffect(() => {
    if (subjectId) setActiveTopics(allTopics.filter(t => t.subject_id === subjectId));
    else { setActiveTopics([]); setTopicId(''); }
  }, [subjectId, allTopics]);

  useEffect(() => {
    if (topicId) setActiveSubtopics(allSubtopics.filter(s => s.topic_id === topicId));
    else { setActiveSubtopics([]); setSubtopicId(''); }
  }, [topicId, allSubtopics]);

  useEffect(() => {
    if (subtopicId) setActiveUnits(allUnits.filter(u => u.subtopic_id === subtopicId));
    else { setActiveUnits([]); setUnitId(''); }
  }, [subtopicId, allUnits]);

  const handleCopyPrompt = () => {
    const topicName = activeTopics.find(t => t.id === topicId)?.name || 'Selected Topic';
    const subtopicName = activeSubtopics.find(s => s.id === subtopicId)?.name || 'Selected Subtopic';
    const unitName = activeUnits.find(u => u.id === unitId)?.name || 'Selected Unit';

    const promptText = `I will provide you with images of textbook pages. Extract the key information relevant ONLY to the following specific SSC CHSL curriculum unit:
- Topic: ${topicName}
- Subtopic: ${subtopicName}
- Target Learning Unit: ${unitName}
- Target Unit ID: ${unitId}

Summarize the main points into concise, high-yield bullet points suitable for competitive exam preparation. Do not invent new learning units. Assign the exact Target Unit ID provided above to all generated records and patterns.

CRITICAL DATABASE CONSTRAINTS:
1. "record_type" MUST be exactly one of: formula, definition, fact, rule, method, example, explanation, other.
2. "level" MUST be exactly one of: easy, moderate, hard.
3. Complexity scores (calculation, wording, decoding) MUST be integers from 1 to 5.

Output your response STRICTLY as a raw JSON object matching this exact structure:

{
  "proposedRecords": [
    {
      "learning_unit_id": "${unitId}",
      "record_type": "fact",
      "title": "High-Yield Summary",
      "content": {
        "bullet_points": ["Extracted fact 1..."]
      }
    }
  ],
  "proposedPatterns": [
    { 
      "learning_unit_id": "${unitId}", 
      "mock_id": "p1", 
      "name": "Identification Question", 
      "description": "...", 
      "easy_definition": "...", 
      "moderate_definition": "...", 
      "hard_definition": "...",
      "example_pattern": "...",
      "generation_rules": {"pattern_type": "Fact"},
      "required_operations": ["recall_fact"]
    }
  ],
  "proposedProfiles": [
    { 
      "pattern_mock_id": "p1", 
      "level": "moderate", 
      "steps_required": 2, 
      "concept_count": 2, 
      "calculation_complexity": 1, 
      "wording_complexity": 2, 
      "decoding_complexity": 2, 
      "target_time_seconds": 45,
      "generation_constraints": {"wording": "contextual"}
    }
  ]
}`;

    navigator.clipboard.writeText(promptText);
    alert('Prompt copied! The AI is locked to this single Learning Unit.');
  };

  async function handleProcessAI() {
    if (!unitId || !passage.trim()) {
      setError("Please select a Learning Unit and paste the JSON payload.");
      return;
    }
    
    setIsProcessing(true);
    setError(null);

    try {
      let cleanedPassage = passage.replace(/\\$/gm, '').replace(/\\\n/g, '\n').replace(/&#x20;/g, ' ').replace(/&nbsp;/g, ' ').trim();
      cleanedPassage = cleanedPassage.replace(/^```(json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      
      if (cleanedPassage.startsWith('{') && cleanedPassage.endsWith('}')) {
        const parsedData = JSON.parse(cleanedPassage);
        setProposedRecords(parsedData.proposedRecords || []);
        setProposedPatterns(parsedData.proposedPatterns || []);
        setProposedProfiles(parsedData.proposedProfiles || []);
        setIsProcessing(false);
      } else {
         throw new Error("Input does not appear to be valid JSON.");
      }
    } catch (err: any) {
      setError(`Parsing Error: ${err.message}`);
      setIsProcessing(false);
    }
  }

  const getEditableText = (content: any) => {
    if (content?.bullet_points && Array.isArray(content.bullet_points)) return content.bullet_points.join('\n');
    return JSON.stringify(content, null, 2);
  };

  const handleRecordUpdate = (index: number, newText: string) => {
    const updated = [...proposedRecords];
    updated[index].content = { bullet_points: newText.split('\n').filter(l => l.trim() !== '') };
    setProposedRecords(updated);
  };

  async function handleApproveAndSave() {
    if (proposedRecords.length === 0 && proposedPatterns.length === 0) return;
    setIsProcessing(true);
    setError(null);
    
    try {
      if (proposedRecords.length > 0) {
        const recordsToInsert = proposedRecords.map(r => ({ ...r, verification_status: 'verified' }));
        const { error: krError } = await supabase.from('knowledge_records').insert(recordsToInsert);
        if (krError) throw krError;
      }

      for (const pattern of proposedPatterns) {
        const { mock_id, ...patternData } = pattern;
        const { data: newPattern, error: pError } = await supabase
          .from('question_patterns')
          .insert({ ...patternData, active: true })
          .select()
          .single();
        if (pError) throw pError;

        const profilesToInsert = proposedProfiles
          .filter(prof => prof.pattern_mock_id === mock_id)
          .map(({ pattern_mock_id, ...profData }) => ({ ...profData, question_pattern_id: newPattern.id }));

        if (profilesToInsert.length > 0) {
          const { error: dpError } = await supabase.from('difficulty_profiles').insert(profilesToInsert);
          if (dpError) throw dpError;
        }
      }

      alert("Successfully saved data to the targeted Learning Unit!");
      
      // Clear staging area
      setProposedRecords([]);
      setProposedPatterns([]);
      setProposedProfiles([]);
      setPassage('');
      setUnitId(''); 
      
      // Refresh the tree to instantly remove the completed unit from the dropdowns
      await fetchPendencyTree();

    } catch (err: any) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="p-8 max-w-7xl mx-auto text-slate-800 bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">Single Unit Studio</h1>
          <p className="text-slate-500 mt-1">Extract and map textbook passages to pending learning units.</p>
        </div>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-1 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="font-semibold text-lg border-b border-slate-100 pb-3 mb-2 flex justify-between items-center">
            1. Target Unit
            {loadingTree && <span className="text-xs text-blue-600 font-normal animate-pulse">Syncing pendency...</span>}
          </h2>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50" value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={loadingTree}>
            <option value="">Select Pending Subject...</option>
            {activeSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 disabled:opacity-50" value={topicId} onChange={e => setTopicId(e.target.value)} disabled={!subjectId || loadingTree}>
            <option value="">Select Pending Topic...</option>
            {activeTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 disabled:opacity-50" value={subtopicId} onChange={e => setSubtopicId(e.target.value)} disabled={!topicId || loadingTree}>
            <option value="">Select Pending Subtopic...</option>
            {activeSubtopics.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="border-2 border-blue-200 p-2.5 rounded-lg bg-blue-50 font-semibold text-blue-900 disabled:opacity-50" value={unitId} onChange={e => setUnitId(e.target.value)} disabled={!subtopicId || loadingTree}>
            <option value="">Select Empty Learning Unit...</option>
            {activeUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-2">
            <h2 className="font-semibold text-lg">2. Source Material</h2>
            <button onClick={handleCopyPrompt} disabled={!unitId} className="text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded disabled:opacity-50">
              Copy Target Prompt
            </button>
          </div>
          <textarea className="flex-1 border border-slate-300 p-4 rounded-lg bg-slate-50 font-mono text-sm min-h-[220px]" placeholder="Paste sanitized JSON from AI..." value={passage} onChange={e => setPassage(e.target.value)} disabled={!unitId || isProcessing} />
          <button onClick={handleProcessAI} disabled={!unitId || !passage.trim() || isProcessing} className="py-3.5 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800 disabled:bg-slate-300">
            {isProcessing ? 'Parsing...' : 'Parse JSON Content'}
          </button>
        </div>
      </div>

      {(proposedRecords.length > 0 || proposedPatterns.length > 0) && (
        <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-emerald-500/20 mb-12">
          <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-6">
            <h2 className="font-bold text-2xl text-slate-800">3. Review & Approve</h2>
            <button onClick={handleApproveAndSave} disabled={isProcessing} className="px-8 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700">
              Confirm and Save
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
              <h3 className="font-bold text-lg mb-4">Extracted Knowledge</h3>
              {proposedRecords.map((rec, idx) => (
                <div key={idx} className="mb-4 bg-white rounded-lg border border-slate-200 shadow-sm">
                  <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                    <input type="text" className="font-bold text-slate-800 bg-transparent border-none p-0 w-full" value={rec.title} onChange={e => { const u = [...proposedRecords]; u[idx].title = e.target.value; setProposedRecords(u); }} />
                  </div>
                  <textarea className="w-full p-4 text-sm text-slate-700 bg-white border-none min-h-[120px]" value={getEditableText(rec.content)} onChange={e => handleRecordUpdate(idx, e.target.value)} />
                </div>
              ))}
            </div>

            <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
              <h3 className="font-bold text-lg mb-4">Generated Patterns</h3>
              {proposedPatterns.map((pat, idx) => (
                <div key={idx} className="mb-4 bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
                  <div className="font-bold text-slate-800 text-lg mb-2">{pat.name}</div>
                  <div className="text-sm text-slate-600 mb-4">{pat.description}</div>
                  <div className="space-y-2">
                    {proposedProfiles.filter(prof => prof.pattern_mock_id === pat.mock_id).map((prof, pIdx) => (
                      <div key={pIdx} className="flex justify-between text-xs border border-slate-100 p-2 rounded bg-slate-50">
                        <span className="font-bold uppercase">{prof.level}</span>
                        <span>Steps: {prof.steps_required} | Decoding: {prof.decoding_complexity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}