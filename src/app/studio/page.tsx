'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Subject, Topic, Subtopic, LearningUnit } from '@/lib/types';

export default function KnowledgeStudio() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subtopics, setSubtopics] = useState<Subtopic[]>([]);
  const [learningUnits, setLearningUnits] = useState<LearningUnit[]>([]);

  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [subtopicId, setSubtopicId] = useState('');

  const [passage, setPassage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [proposedLearningUnits, setProposedLearningUnits] = useState<any[]>([]);
  const [proposedRecords, setProposedRecords] = useState<any[]>([]);
  const [proposedPatterns, setProposedPatterns] = useState<any[]>([]);
  const [proposedProfiles, setProposedProfiles] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('subjects').select('*').order('name').then(({ data }) => setSubjects(data || []));
  }, []);

  useEffect(() => {
    if (subjectId) supabase.from('topics').select('*').eq('subject_id', subjectId).order('sequence').then(({ data }) => setTopics(data || []));
    else setTopics([]);
    setTopicId('');
  }, [subjectId]);

  useEffect(() => {
    if (topicId) supabase.from('subtopics').select('*').eq('topic_id', topicId).order('sequence').then(({ data }) => setSubtopics(data || []));
    else setSubtopics([]);
    setSubtopicId('');
  }, [topicId]);

  useEffect(() => {
    if (subtopicId) supabase.from('learning_units').select('*').eq('subtopic_id', subtopicId).order('sequence').then(({ data }) => setLearningUnits(data || []));
    else setLearningUnits([]);
  }, [subtopicId]);

  const handleCopyPrompt = () => {
    const topicName = topics.find(t => t.id === topicId)?.name || 'Selected Topic';
    const subtopicName = subtopics.find(s => s.id === subtopicId)?.name || 'Selected Subtopic';
    
    const unitList = learningUnits.map(u => `- ID: "${u.id}" | Name: "${u.name}"`).join('\n');

    const promptText = `I will provide you with images of textbook pages. Please read the text and extract the key information relevant to the following SSC CHSL curriculum context:
- Topic: ${topicName}
- Subtopic: ${subtopicName}

Available Learning Units:
${unitList}

Summarize the main points into concise, high-yield bullet points suitable for competitive exam preparation. Categorize your extracted records and question patterns by assigning the exact Learning Unit ID from the list above. 

IMPORTANT: First, analyze the provided Topic, Subtopic, and image text. If you find critical exam-relevant information that strictly belongs to this Topic and Subtopic, but does NOT fit into any of the Available Learning Units, you must propose NEW Learning Units. If the information fits existing units, do not propose new ones. When proposing a new unit, assign it a temporary mock_id (e.g., "new_lu_1") and use that exact mock_id in the "learning_unit_id" field of the corresponding records and patterns.

CRITICAL DATABASE CONSTRAINTS:
1. "record_type" MUST be exactly one of: formula, definition, fact, rule, method, example, explanation, other.
2. "level" MUST be exactly one of: easy, moderate, hard.
3. Complexity scores (calculation, wording, decoding) MUST be integers from 1 to 5.

Output your response STRICTLY as a raw JSON object matching this exact structure. Do not include markdown formatting, code fences, or conversational text:

{
  "proposedLearningUnits": [
    {
      "mock_id": "new_lu_1",
      "name": "Newly Discovered Sub-Theme",
      "description": "Brief description of what this unit covers."
    }
  ],
  "proposedRecords": [
    {
      "learning_unit_id": "paste-exact-id-here-OR-use-mock_id",
      "record_type": "fact",
      "title": "High-Yield Summary",
      "content": {
        "bullet_points": [
          "First extracted key fact..."
        ]
      }
    }
  ],
  "proposedPatterns": [
    { 
      "learning_unit_id": "paste-exact-id-here-OR-use-mock_id", 
      "mock_id": "p1", 
      "name": "Identification & Recall", 
      "description": "Identify the correct statement based on the passage.", 
      "easy_definition": "Direct recall.", 
      "moderate_definition": "Contextual recall.", 
      "hard_definition": "Multi-statement inference.",
      "example_pattern": "Identify the correct X.",
      "generation_rules": {"pattern_type": "Fact Retrieval", "target_exams": ["SSC_CHSL"]},
      "required_operations": ["recall_fact"]
    }
  ],
  "proposedProfiles": [
    { 
      "pattern_mock_id": "p1", 
      "level": "easy", 
      "steps_required": 1, 
      "concept_count": 1, 
      "calculation_complexity": 1, 
      "wording_complexity": 1, 
      "decoding_complexity": 1, 
      "target_time_seconds": 30,
      "generation_constraints": {"wording": "direct"}
    }
  ]
}`;

    navigator.clipboard.writeText(promptText);
    alert('Prompt copied! The AI is now instructed to propose new Learning Units if necessary.');
  };

  async function handleProcessAI() {
    if (!subtopicId || !passage.trim()) {
      setError("Please select a Subtopic and paste the JSON payload.");
      return;
    }
    
    setIsProcessing(true);
    setError(null);

    try {
      // 1. Aggressively sanitize the input to remove AI formatting artifacts
      let cleanedPassage = passage
        .replace(/\\$/gm, '')      // Remove trailing backslashes at the end of lines
        .replace(/\\\n/g, '\n')    // Remove backslashes followed by newlines
        .replace(/&#x20;/g, ' ')   // Replace hex space entities
        .replace(/&nbsp;/g, ' ')   // Replace HTML space entities
        .trim();

      // 2. Strip markdown code fences if the AI included them (e.g. ```json ... ```)
      cleanedPassage = cleanedPassage.replace(/^```(json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      
      if (cleanedPassage.startsWith('{') && cleanedPassage.endsWith('}')) {
        const parsedData = JSON.parse(cleanedPassage);
        setProposedLearningUnits(parsedData.proposedLearningUnits || []);
        setProposedRecords(parsedData.proposedRecords || []);
        setProposedPatterns(parsedData.proposedPatterns || []);
        setProposedProfiles(parsedData.proposedProfiles || []);
        setIsProcessing(false);
      } else {
         throw new Error("Input does not appear to be valid JSON. Please paste the raw JSON output from the AI.");
      }
    } catch (err: any) {
      setError(`Parsing Error: ${err.message}. Check if the AI truncated the JSON response.`);
      setIsProcessing(false);
    }
  }

  const getEditableText = (content: any) => {
    if (content?.bullet_points && Array.isArray(content.bullet_points)) {
      return content.bullet_points.join('\n');
    }
    return JSON.stringify(content, null, 2);
  };

  const handleRecordUpdate = (index: number, newText: string) => {
    const updated = [...proposedRecords];
    const lines = newText.split('\n').filter(line => line.trim() !== '');
    updated[index].content = { bullet_points: lines };
    setProposedRecords(updated);
  };

  const getUnitName = (id: string) => {
    const existingUnit = learningUnits.find(u => u.id === id);
    if (existingUnit) return existingUnit.name;
    const proposedUnit = proposedLearningUnits.find(u => u.mock_id === id);
    if (proposedUnit) return `✨ NEW: ${proposedUnit.name}`;
    return 'Unknown Unit';
  };

  async function handleApproveAndSave() {
    if (proposedRecords.length === 0 && proposedPatterns.length === 0 && proposedLearningUnits.length === 0) return;
    setIsProcessing(true);
    setError(null);
    
    try {
      const unitIdMap: Record<string, string> = {};

      // 1. Insert newly proposed learning units first and map their mock IDs to real UUIDs
      for (const unit of proposedLearningUnits) {
        const { data: newUnit, error: uError } = await supabase
          .from('learning_units')
          .insert({
            subtopic_id: subtopicId,
            name: unit.name,
            description: unit.description,
            active: true
          })
          .select()
          .single();
        
        if (uError) throw uError;
        unitIdMap[unit.mock_id] = newUnit.id;
      }

      // 2. Insert Knowledge Records (swapping mock IDs for real ones if needed)
      if (proposedRecords.length > 0) {
        const recordsToInsert = proposedRecords.map(r => ({ 
          ...r, 
          learning_unit_id: unitIdMap[r.learning_unit_id] || r.learning_unit_id,
          verification_status: 'verified' 
        }));
        const { error: krError } = await supabase.from('knowledge_records').insert(recordsToInsert);
        if (krError) throw krError;
      }

      // 3. Insert Question Patterns and Profiles (swapping mock IDs for real ones if needed)
      for (const pattern of proposedPatterns) {
        const { mock_id, ...patternData } = pattern;
        const mappedUnitId = unitIdMap[patternData.learning_unit_id] || patternData.learning_unit_id;

        const { data: newPattern, error: pError } = await supabase
          .from('question_patterns')
          .insert({ ...patternData, learning_unit_id: mappedUnitId, active: true })
          .select()
          .single();
        
        if (pError) throw pError;

        const profilesToInsert = proposedProfiles
          .filter(prof => prof.pattern_mock_id === mock_id)
          .map(({ pattern_mock_id, ...profData }) => ({
            ...profData,
            question_pattern_id: newPattern.id
          }));

        if (profilesToInsert.length > 0) {
          const { error: dpError } = await supabase.from('difficulty_profiles').insert(profilesToInsert);
          if (dpError) throw dpError;
        }
      }

      alert("Successfully saved mapped data (including new Learning Units) to the curriculum database!");
      
      // Refresh learning units to show the newly added ones
      const { data: updatedUnits } = await supabase.from('learning_units').select('*').eq('subtopic_id', subtopicId).order('sequence');
      if (updatedUnits) setLearningUnits(updatedUnits);

      setProposedLearningUnits([]);
      setProposedRecords([]);
      setProposedPatterns([]);
      setProposedProfiles([]);
      setPassage('');
      
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
          <h1 className="text-3xl font-extrabold text-slate-900">Knowledge Studio</h1>
          <p className="text-slate-500 mt-1">Extract, review, and map textbook passages directly to learning units.</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6 border border-red-200 flex items-center shadow-sm">
          <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-1 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-2">
            <div className="bg-blue-100 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center font-bold">1</div>
            <h2 className="font-semibold text-lg">Curriculum Target</h2>
          </div>
          
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all" value={subjectId} onChange={e => setSubjectId(e.target.value)}>
            <option value="">Select Subject...</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50" value={topicId} onChange={e => setTopicId(e.target.value)} disabled={!subjectId}>
            <option value="">Select Topic...</option>
            {topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50" value={subtopicId} onChange={e => setSubtopicId(e.target.value)} disabled={!topicId}>
            <option value="">Select Subtopic...</option>
            {subtopics.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-2">
            <div className="flex items-center gap-2">
              <div className="bg-blue-100 text-blue-700 w-8 h-8 rounded-full flex items-center justify-center font-bold">2</div>
              <h2 className="font-semibold text-lg">Source Material</h2>
            </div>
            <button 
              onClick={handleCopyPrompt}
              disabled={!subtopicId}
              className="text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>
              Copy AI Prompt
            </button>
          </div>
          
          <textarea 
            className="flex-1 border border-slate-300 p-4 rounded-lg bg-slate-50 text-sm min-h-[220px] focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-400 leading-relaxed font-mono" 
            placeholder="Paste formatted JSON directly from your external AI..."
            value={passage}
            onChange={e => setPassage(e.target.value)}
            disabled={!subtopicId || isProcessing}
          />
          <button 
            onClick={handleProcessAI}
            disabled={!subtopicId || !passage.trim() || isProcessing}
            className="py-3.5 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all shadow-sm flex justify-center items-center gap-2"
          >
            {isProcessing ? (
              <><span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></span> Parsing...</>
            ) : (
              'Parse JSON Content'
            )}
          </button>
        </div>
      </div>

      {(proposedRecords.length > 0 || proposedPatterns.length > 0 || proposedLearningUnits.length > 0) && (
        <div className="bg-white p-6 rounded-xl shadow-lg border-2 border-emerald-500/20 mb-12">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-100 pb-4 mb-6 gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-emerald-100 text-emerald-700 w-8 h-8 rounded-full flex items-center justify-center font-bold">3</div>
              <h2 className="font-bold text-2xl text-slate-800">Review & Approve</h2>
            </div>
            <button 
              onClick={handleApproveAndSave}
              disabled={isProcessing}
              className="px-8 py-3 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm w-full md:w-auto"
            >
              Confirm and Save to Database
            </button>
          </div>

          {/* New Learning Units Banner */}
          {proposedLearningUnits.length > 0 && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <h3 className="font-bold text-amber-800 mb-2 flex items-center gap-2">
                ✨ AI Proposed New Learning Units
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {proposedLearningUnits.map((u, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border border-amber-100 shadow-sm text-sm">
                    <div className="font-bold text-slate-800">{u.name}</div>
                    <div className="text-slate-600 mt-1">{u.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
              <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
                <span className="bg-blue-600 w-2 h-2 rounded-full"></span>
                Extracted Knowledge
              </h3>
              {proposedRecords.map((rec, idx) => (
                <div key={idx} className="mb-4 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                  <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex flex-col gap-1">
                    <div className="flex justify-between items-center">
                      <input 
                        type="text" 
                        className="font-bold text-slate-800 bg-transparent border-none p-0 focus:ring-0 w-full"
                        value={rec.title}
                        onChange={(e) => {
                          const updated = [...proposedRecords];
                          updated[idx].title = e.target.value;
                          setProposedRecords(updated);
                        }}
                      />
                      <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2.5 py-0.5 rounded-full uppercase tracking-wide ml-2">{rec.record_type}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-medium">{getUnitName(rec.learning_unit_id)}</div>
                  </div>
                  <textarea 
                    className="w-full p-4 text-sm text-slate-700 bg-white border-none focus:ring-0 min-h-[120px] leading-relaxed resize-y outline-none"
                    value={getEditableText(rec.content)}
                    onChange={(e) => handleRecordUpdate(idx, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
              <h3 className="font-bold text-lg mb-4 text-slate-800 flex items-center gap-2">
                <span className="bg-purple-600 w-2 h-2 rounded-full"></span>
                Generated Question Frameworks
              </h3>
              {proposedPatterns.map((pat, idx) => (
                <div key={idx} className="mb-4 bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-bold text-slate-800 text-lg">{pat.name}</div>
                  </div>
                  <div className="text-xs text-slate-500 mb-2 font-medium">{getUnitName(pat.learning_unit_id)}</div>
                  <div className="text-sm text-slate-600 mb-4 bg-slate-50 p-3 rounded border border-slate-100">{pat.description}</div>
                  
                  <div className="space-y-2">
                    {proposedProfiles.filter(prof => prof.pattern_mock_id === pat.mock_id).map((prof, pIdx) => (
                      <div key={pIdx} className="flex flex-col sm:flex-row sm:items-center justify-between text-xs border border-slate-100 p-3 rounded-md bg-white hover:bg-slate-50 transition-colors">
                        <span className={`font-bold uppercase tracking-wider px-2 py-1 rounded-sm mb-2 sm:mb-0 text-center sm:text-left ${
                          prof.level === 'easy' ? 'bg-green-100 text-green-800' : 
                          prof.level === 'moderate' ? 'bg-yellow-100 text-yellow-800' : 
                          'bg-red-100 text-red-800'
                        }`}>
                          {prof.level}
                        </span>
                        <div className="flex gap-3 text-slate-500 font-medium justify-center sm:justify-end">
                          <span className="bg-slate-100 px-2 py-1 rounded">Steps: {prof.steps_required}</span>
                          <span className="bg-slate-100 px-2 py-1 rounded">Concepts: {prof.concept_count}</span>
                          <span className="bg-slate-100 px-2 py-1 rounded">Decode: {prof.decoding_complexity}</span>
                        </div>
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