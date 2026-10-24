'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Subject, Topic, Subtopic, LearningUnit, KnowledgeRecord, QuestionPattern, DifficultyProfile } from '@/lib/types';

export default function CurriculumManager() {
  // Navigation States
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subtopics, setSubtopics] = useState<Subtopic[]>([]);
  const [learningUnits, setLearningUnits] = useState<LearningUnit[]>([]);

  // Selection States
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [selectedSubtopic, setSelectedSubtopic] = useState<Subtopic | null>(null);
  const [selectedLearningUnit, setSelectedLearningUnit] = useState<LearningUnit | null>(null);
  const [selectedPattern, setSelectedPattern] = useState<QuestionPattern | null>(null);

  // Detail States
  const [knowledgeRecords, setKnowledgeRecords] = useState<KnowledgeRecord[]>([]);
  const [questionPatterns, setQuestionPatterns] = useState<QuestionPattern[]>([]);
  const [difficultyProfiles, setDifficultyProfiles] = useState<DifficultyProfile[]>([]);

  // UI States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal States
  const [modalOpen, setModalOpen] = useState(false);
  const [modalConfig, setModalConfig] = useState<{ table: string; title: string; record: any; parentIdField?: string; parentIdValue?: string } | null>(null);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    fetchSubjects();
  }, []);

  // --- Fetch Data ---
  async function fetchSubjects() {
    setLoading(true);
    const { data, error } = await supabase.from('subjects').select('*').order('name');
    if (error) setError(error.message);
    else setSubjects(data || []);
    setLoading(false);
  }

  async function handleSubjectClick(subject: Subject) {
    setSelectedSubject(subject); setSelectedTopic(null); setSelectedSubtopic(null); setSelectedLearningUnit(null);
    setTopics([]); setSubtopics([]); setLearningUnits([]);
    const { data } = await supabase.from('topics').select('*').eq('subject_id', subject.id).order('sequence');
    setTopics(data || []);
  }

  async function handleTopicClick(topic: Topic) {
    setSelectedTopic(topic); setSelectedSubtopic(null); setSelectedLearningUnit(null);
    setSubtopics([]); setLearningUnits([]);
    const { data } = await supabase.from('subtopics').select('*').eq('topic_id', topic.id).order('sequence');
    setSubtopics(data || []);
  }

  async function handleSubtopicClick(subtopic: Subtopic) {
    setSelectedSubtopic(subtopic); setSelectedLearningUnit(null);
    setLearningUnits([]);
    const { data } = await supabase.from('learning_units').select('*').eq('subtopic_id', subtopic.id).order('sequence');
    setLearningUnits(data || []);
  }

  async function handleLearningUnitClick(unit: LearningUnit) {
    setSelectedLearningUnit(unit);
    setSelectedPattern(null);
    
    const [krRes, qpRes] = await Promise.all([
      supabase.from('knowledge_records').select('*').eq('learning_unit_id', unit.id).order('created_at'),
      supabase.from('question_patterns').select('*').eq('learning_unit_id', unit.id).order('created_at')
    ]);

    setKnowledgeRecords(krRes.data || []);
    setQuestionPatterns(qpRes.data || []);
    setDifficultyProfiles([]);
  }

  async function handlePatternClick(pattern: QuestionPattern) {
    setSelectedPattern(pattern);
    const { data } = await supabase.from('difficulty_profiles').select('*').eq('question_pattern_id', pattern.id);
    setDifficultyProfiles(data || []);
  }

  // --- CRUD Operations ---
  async function handleDelete(table: string, id: string, refreshCallback: () => void) {
    if (!window.confirm('Are you sure you want to delete this record?')) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) alert(`Error deleting: ${error.message}`);
    else refreshCallback();
  }

  function openModal(table: string, title: string, record: any = null, parentIdField?: string, parentIdValue?: string) {
    setModalConfig({ table, title, record, parentIdField, parentIdValue });
    
    // Parse JSON fields to string for editing
    const initialData = { ...record };
    for (const key in initialData) {
      if (typeof initialData[key] === 'object' && initialData[key] !== null) {
        initialData[key] = JSON.stringify(initialData[key], null, 2);
      }
    }
    setFormData(initialData || {});
    setModalOpen(true);
  }

  async function handleModalSave(e: React.FormEvent) {
    e.preventDefault();
    if (!modalConfig) return;

    const payload = { ...formData };
    
    // Auto-inject parent ID if it's a new record
    if (!payload.id && modalConfig.parentIdField && modalConfig.parentIdValue) {
      payload[modalConfig.parentIdField] = modalConfig.parentIdValue;
    }

    // Try parsing stringified JSON back to objects
    for (const key in payload) {
      if (typeof payload[key] === 'string' && (payload[key].startsWith('{') || payload[key].startsWith('['))) {
        try {
          payload[key] = JSON.parse(payload[key]);
        } catch (e) {
          // Keep as string if parsing fails, Supabase will reject if it expects JSONB
        }
      }
    }

    let error;
    if (payload.id) {
      const { id, ...updateData } = payload;
      const res = await supabase.from(modalConfig.table).update(updateData).eq('id', id);
      error = res.error;
    } else {
      const res = await supabase.from(modalConfig.table).insert([payload]);
      error = res.error;
    }

    if (error) {
      alert(`Error saving: ${error.message}`);
    } else {
      setModalOpen(false);
      // Refresh the appropriate list
      if (modalConfig.table === 'subjects') fetchSubjects();
      else if (modalConfig.table === 'topics' && selectedSubject) handleSubjectClick(selectedSubject);
      else if (modalConfig.table === 'subtopics' && selectedTopic) handleTopicClick(selectedTopic);
      else if (modalConfig.table === 'learning_units' && selectedSubtopic) handleSubtopicClick(selectedSubtopic);
      else if (['knowledge_records', 'question_patterns'].includes(modalConfig.table) && selectedLearningUnit) handleLearningUnitClick(selectedLearningUnit);
      else if (modalConfig.table === 'difficulty_profiles' && selectedPattern) handlePatternClick(selectedPattern);
    }
  }

  return (
    <main className="p-4 md:p-8 max-w-[1600px] mx-auto text-gray-800 flex flex-col h-screen">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h1 className="text-2xl font-bold">Curriculum Manager</h1>
      </div>
      
      {/* 4-Column Browser */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 h-[40vh] shrink-0 mb-6">
        
        {/* Subjects */}
        <div className="border rounded bg-gray-50 flex flex-col">
          <div className="p-3 border-b bg-white flex justify-between items-center font-bold">
            Subjects <button onClick={() => openModal('subjects', 'Subject')} className="text-blue-600 text-sm hover:underline">+ Add</button>
          </div>
          <div className="p-2 overflow-y-auto flex-1">
            {loading && !selectedSubject && <p className="text-sm text-gray-500">Loading...</p>}
            {subjects.map(sub => (
              <div key={sub.id} className={`p-2 mb-2 border rounded cursor-pointer text-sm group flex justify-between ${selectedSubject?.id === sub.id ? 'bg-blue-100 border-blue-300' : 'bg-white hover:bg-gray-100'}`}>
                <span onClick={() => handleSubjectClick(sub)} className="flex-1">{sub.name}</span>
                <div className="hidden group-hover:flex gap-2">
                  <button onClick={() => openModal('subjects', 'Subject', sub)} className="text-gray-500 hover:text-blue-600">✎</button>
                  <button onClick={() => handleDelete('subjects', sub.id, fetchSubjects)} className="text-gray-500 hover:text-red-600">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Topics */}
        <div className="border rounded bg-gray-50 flex flex-col">
          <div className="p-3 border-b bg-white flex justify-between items-center font-bold">
            Topics 
            {selectedSubject && <button onClick={() => openModal('topics', 'Topic', null, 'subject_id', selectedSubject.id)} className="text-blue-600 text-sm hover:underline">+ Add</button>}
          </div>
          <div className="p-2 overflow-y-auto flex-1">
            {topics.map(top => (
              <div key={top.id} className={`p-2 mb-2 border rounded cursor-pointer text-sm group flex justify-between ${selectedTopic?.id === top.id ? 'bg-blue-100 border-blue-300' : 'bg-white hover:bg-gray-100'}`}>
                <span onClick={() => handleTopicClick(top)} className="flex-1">{top.name}</span>
                <div className="hidden group-hover:flex gap-2">
                  <button onClick={() => openModal('topics', 'Topic', top)} className="text-gray-500 hover:text-blue-600">✎</button>
                  <button onClick={() => handleDelete('topics', top.id, () => handleSubjectClick(selectedSubject!))} className="text-gray-500 hover:text-red-600">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Subtopics */}
        <div className="border rounded bg-gray-50 flex flex-col">
          <div className="p-3 border-b bg-white flex justify-between items-center font-bold">
            Subtopics
            {selectedTopic && <button onClick={() => openModal('subtopics', 'Subtopic', null, 'topic_id', selectedTopic.id)} className="text-blue-600 text-sm hover:underline">+ Add</button>}
          </div>
          <div className="p-2 overflow-y-auto flex-1">
            {subtopics.map(subtop => (
              <div key={subtop.id} className={`p-2 mb-2 border rounded cursor-pointer text-sm group flex justify-between ${selectedSubtopic?.id === subtop.id ? 'bg-blue-100 border-blue-300' : 'bg-white hover:bg-gray-100'}`}>
                <span onClick={() => handleSubtopicClick(subtop)} className="flex-1">{subtop.name}</span>
                <div className="hidden group-hover:flex gap-2">
                  <button onClick={() => openModal('subtopics', 'Subtopic', subtop)} className="text-gray-500 hover:text-blue-600">✎</button>
                  <button onClick={() => handleDelete('subtopics', subtop.id, () => handleTopicClick(selectedTopic!))} className="text-gray-500 hover:text-red-600">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Learning Units */}
        <div className="border rounded bg-gray-50 flex flex-col">
          <div className="p-3 border-b bg-white flex justify-between items-center font-bold">
            Learning Units
            {selectedSubtopic && <button onClick={() => openModal('learning_units', 'Learning Unit', null, 'subtopic_id', selectedSubtopic.id)} className="text-blue-600 text-sm hover:underline">+ Add</button>}
          </div>
          <div className="p-2 overflow-y-auto flex-1">
            {learningUnits.map(unit => (
              <div key={unit.id} className={`p-2 mb-2 border rounded cursor-pointer text-sm group flex justify-between ${selectedLearningUnit?.id === unit.id ? 'bg-blue-100 border-blue-300' : 'bg-white hover:bg-gray-100'}`}>
                <span onClick={() => handleLearningUnitClick(unit)} className="flex-1">{unit.name}</span>
                <div className="hidden group-hover:flex gap-2">
                  <button onClick={() => openModal('learning_units', 'Learning Unit', unit)} className="text-gray-500 hover:text-blue-600">✎</button>
                  <button onClick={() => handleDelete('learning_units', unit.id, () => handleSubtopicClick(selectedSubtopic!))} className="text-gray-500 hover:text-red-600">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Details Panel (Knowledge Records & Question Patterns) */}
      {selectedLearningUnit && (
        <div className="flex-1 flex flex-col min-h-0 border-t-4 border-gray-200 pt-4">
          <h2 className="text-xl font-bold mb-4">Unit Details: {selectedLearningUnit.name}</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 flex-1 min-h-0 overflow-y-auto pb-8">
            
            {/* Knowledge Records */}
            <div className="border rounded bg-gray-50 flex flex-col">
              <div className="p-3 border-b bg-white flex justify-between items-center font-bold">
                Knowledge Records ({knowledgeRecords.length})
                <button onClick={() => openModal('knowledge_records', 'Knowledge Record', null, 'learning_unit_id', selectedLearningUnit.id)} className="text-blue-600 text-sm hover:underline">+ Add</button>
              </div>
              <div className="p-3 flex-1 overflow-y-auto">
                {knowledgeRecords.map(kr => (
                  <div key={kr.id} className="p-3 mb-3 bg-white border rounded shadow-sm text-sm group">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-blue-800">{kr.title}</span>
                      <div className="hidden group-hover:flex gap-2">
                        <button onClick={() => openModal('knowledge_records', 'Knowledge Record', kr)} className="text-gray-500 hover:text-blue-600">✎</button>
                        <button onClick={() => handleDelete('knowledge_records', kr.id, () => handleLearningUnitClick(selectedLearningUnit))} className="text-gray-500 hover:text-red-600">✕</button>
                      </div>
                    </div>
                    <span className="inline-block px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded mb-2">{kr.record_type} | {kr.verification_status}</span>
                    <pre className="whitespace-pre-wrap text-gray-600 text-xs bg-gray-50 p-2 rounded border">{JSON.stringify(kr.content, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </div>

            {/* Question Patterns */}
            <div className="border rounded bg-gray-50 flex flex-col">
              <div className="p-3 border-b bg-white flex justify-between items-center font-bold">
                Question Patterns ({questionPatterns.length})
                <button onClick={() => openModal('question_patterns', 'Question Pattern', null, 'learning_unit_id', selectedLearningUnit.id)} className="text-blue-600 text-sm hover:underline">+ Add</button>
              </div>
              <div className="p-3 flex-1 overflow-y-auto">
                {questionPatterns.map(qp => (
                  <div key={qp.id} onClick={() => handlePatternClick(qp)} className={`p-3 mb-3 bg-white border rounded shadow-sm text-sm cursor-pointer group ${selectedPattern?.id === qp.id ? 'ring-2 ring-blue-400' : ''}`}>
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-green-800">{qp.name}</span>
                      <div className="hidden group-hover:flex gap-2">
                        <button onClick={() => openModal('question_patterns', 'Question Pattern', qp)} className="text-gray-500 hover:text-blue-600">✎</button>
                        <button onClick={() => handleDelete('question_patterns', qp.id, () => handleLearningUnitClick(selectedLearningUnit))} className="text-gray-500 hover:text-red-600">✕</button>
                      </div>
                    </div>
                    <p className="text-gray-600 text-xs mt-1">{qp.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Difficulty Profiles */}
            <div className="border rounded bg-gray-50 flex flex-col">
              <div className="p-3 border-b bg-white flex justify-between items-center font-bold">
                Difficulty Profiles
                {selectedPattern && <button onClick={() => openModal('difficulty_profiles', 'Difficulty Profile', null, 'question_pattern_id', selectedPattern.id)} className="text-blue-600 text-sm hover:underline">+ Add</button>}
              </div>
              <div className="p-3 flex-1 overflow-y-auto">
                {!selectedPattern && <p className="text-sm text-gray-500 italic">Select a Question Pattern to view profiles.</p>}
                {difficultyProfiles.map(dp => (
                  <div key={dp.id} className="p-3 mb-3 bg-white border rounded shadow-sm text-sm group">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold uppercase tracking-wider text-purple-800">{dp.level}</span>
                      <div className="hidden group-hover:flex gap-2">
                        <button onClick={() => openModal('difficulty_profiles', 'Difficulty Profile', dp)} className="text-gray-500 hover:text-blue-600">✎</button>
                        <button onClick={() => handleDelete('difficulty_profiles', dp.id, () => handlePatternClick(selectedPattern!))} className="text-gray-500 hover:text-red-600">✕</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                      <div>Steps: {dp.steps_required}</div>
                      <div>Concepts: {dp.concept_count}</div>
                      <div>Calc. Comp: {dp.calculation_complexity}</div>
                      <div>Word. Comp: {dp.wording_complexity}</div>
                      <div>Decode Comp: {dp.decoding_complexity}</div>
                      <div>Time (s): {dp.target_time_seconds}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Universal CRUD Modal */}
      {modalOpen && modalConfig && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex justify-between items-center font-bold text-lg">
              {modalConfig.record ? 'Edit' : 'Add'} {modalConfig.title}
              <button onClick={() => setModalOpen(false)} className="text-gray-500 hover:text-black">✕</button>
            </div>
            <form onSubmit={handleModalSave} className="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
              
              {/* Dynamic Form Fields based on state */}
              <div className="text-sm text-gray-500 mb-2">
                Enter raw text or valid JSON for JSONB fields. Required fields must not be empty.
              </div>
              
              {['name', 'title', 'code', 'record_type', 'verification_status', 'level'].map(key => (
                formData[key] !== undefined || !modalConfig.record ? (
                   <div key={key} className="flex flex-col">
                     <label className="font-medium text-sm mb-1 capitalize">{key.replace('_', ' ')}</label>
                     <input 
                       className="border p-2 rounded" 
                       value={formData[key] || ''} 
                       onChange={e => setFormData({...formData, [key]: e.target.value})} 
                       placeholder={`Enter ${key}...`}
                     />
                   </div>
                ) : null
              ))}

              {['description', 'concept_notes', 'rules', 'content', 'prerequisites', 'generation_rules', 'required_operations', 'easy_definition', 'moderate_definition', 'hard_definition', 'example_pattern', 'generation_contract', 'generation_constraints'].map(key => (
                formData[key] !== undefined || (!modalConfig.record && ['description', 'content'].includes(key)) ? (
                  <div key={key} className="flex flex-col">
                    <label className="font-medium text-sm mb-1 capitalize">{key.replace('_', ' ')} (Text/JSON)</label>
                    <textarea 
                      className="border p-2 rounded font-mono text-sm" 
                      rows={4}
                      value={formData[key] || ''} 
                      onChange={e => setFormData({...formData, [key]: e.target.value})} 
                    />
                  </div>
                ) : null
              ))}

              <div className="flex gap-4 mt-4">
                <button type="button" onClick={() => setModalOpen(false)} className="flex-1 py-2 border rounded hover:bg-gray-50">Cancel</button>
                <button type="submit" className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}