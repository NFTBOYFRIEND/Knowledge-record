'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Bulletproof helper to fetch every single row, stabilize pagination, and deduplicate
async function fetchAllRows(table: string, select: string, orderBy: string = 'id') {
  let allData: any[] = [];
  let from = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderBy)
      .order('id', { ascending: true }) 
      .range(from, from + limit - 1);

    if (error) throw new Error(`Error fetching ${table}: ${error.message}`);
    
    allData = allData.concat(data || []);
    
    if (!data || data.length < limit) {
      break; 
    }
    from += limit;
  }
  
  const uniqueData = Array.from(new Map(allData.map(item => [item.id, item])).values());
  return uniqueData;
}

export default function KnowledgeStudio() {
  // Master Filtered Data
  const [allSubjects, setAllSubjects] = useState<any[]>([]);
  const [allTopics, setAllTopics] = useState<any[]>([]);
  const [allSubtopics, setAllSubtopics] = useState<any[]>([]);
  const [allUnits, setAllUnits] = useState<any[]>([]);

  // Active Dropdown Options
  const [activeSubjects, setActiveSubjects] = useState<any[]>([]);
  const [activeTopics, setActiveTopics] = useState<any[]>([]);
  const [activeSubtopics, setActiveSubtopics] = useState<any[]>([]);

  // Selection States
  const [subjectId, setSubjectId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [subtopicId, setSubtopicId] = useState('');

  const [passage, setPassage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [proposedLearningUnits, setProposedLearningUnits] = useState<any[]>([]);
  const [proposedRecords, setProposedRecords] = useState<any[]>([]);
  const [proposedPatterns, setProposedPatterns] = useState<any[]>([]);
  const [proposedProfiles, setProposedProfiles] = useState<any[]>([]);

  async function fetchPendencyTree() {
    setLoadingTree(true);
    try {
      // 1. Fetch absolutely everything
      const [krRes, uRes, stRes, tRes, sRes] = await Promise.all([
        fetchAllRows('knowledge_records', 'id, learning_unit_id'), 
        fetchAllRows('learning_units', 'id, name, subtopic_id', 'sequence'),
        fetchAllRows('subtopics', 'id, name, topic_id', 'sequence'),
        fetchAllRows('topics', 'id, name, subject_id', 'sequence'),
        fetchAllRows('subjects', 'id, name', 'name')
      ]);

      // 2. Identify occupied units
      const occupiedIds = new Set(krRes.map(r => r.learning_unit_id));

      // 3. Filter units to keep ONLY empty ones
      const emptyUnits = uRes.filter(u => !occupiedIds.has(u.id));
      const validSubtopicIds = new Set(emptyUnits.map(u => u.subtopic_id));

      // 4. Keep Subtopics that have at least one empty unit
      const validSubtopics = stRes.filter(s => validSubtopicIds.has(s.id));
      const validTopicIds = new Set(validSubtopics.map(s => s.topic_id));

      // 5. Keep Topics that have at least one valid subtopic
      const validTopics = tRes.filter(t => validTopicIds.has(t.id));
      const validSubjectIds = new Set(validTopics.map(t => t.subject_id));

      // 6. Keep Subjects that have at least one valid topic
      const validSubjects = sRes.filter(s => validSubjectIds.has(s.id));

      setAllSubjects(validSubjects);
      setAllTopics(validTopics);
      setAllSubtopics(validSubtopics);
      setAllUnits(emptyUnits); // Stored silently so we can pass them to the AI prompt

      setActiveSubjects(validSubjects);

      // Clear invalid selections
      if (!validTopicIds.has(topicId)) setTopicId('');
      if (!validSubtopicIds.has(subtopicId)) setSubtopicId('');

    } catch (err: any) {
      setError(`Error loading curriculum: ${err.message}`);
    } finally {
      setLoadingTree(false);
    }
  }

  useEffect(() => {
    fetchPendencyTree();
  }, []);

  // Client-side cascading dropdown logic
  useEffect(() => {
    if (subjectId) setActiveTopics(allTopics.filter(t => t.subject_id === subjectId));
    else { setActiveTopics([]); setTopicId(''); }
  }, [subjectId, allTopics]);

  useEffect(() => {
    if (topicId) setActiveSubtopics(allSubtopics.filter(s => s.topic_id === topicId));
    else { setActiveSubtopics([]); setSubtopicId(''); }
  }, [topicId, allSubtopics]);

  const handleCopyPrompt = () => {
    const topicName = activeTopics.find(t => t.id === topicId)?.name || 'Selected Topic';
    const subtopicName = activeSubtopics.find(s => s.id === subtopicId)?.name || 'Selected Subtopic';
    
    // Extract only the empty learning units for the currently selected subtopic
    const activeUnits = allUnits.filter(u => u.subtopic_id === subtopicId);
    const unitList = activeUnits.map(u => `- ID: "${u.id}" | Name: "${u.name}"`).join('\n');

    const promptText = `# STRICT COMPETITIVE-EXAM KNOWLEDGE EXTRACTION

## ROLE
Act as a competitive-examination MCQ content selector, subject-matter analyst, and structured knowledge-base designer.

Your task is NOT to produce a general textbook summary.
Your task is to extract accurate, high-yield, testable knowledge from the supplied textbook images and organize it for generating competitive-examination MCQs.

## CURRICULUM CONTEXT
Target examination: SSC_CHSL
Subject: ${activeSubjects.find(s => s.id === subjectId)?.name || 'Selected Subject'}
Topic: ${topicName}
Subtopic: ${subtopicName}

## EXISTING LEARNING UNITS
${unitList}

These Learning Units are the authoritative classification options.
Use their exact IDs and names. Do not invent replacement IDs.

## STAGE 1 — SOURCE INSPECTION AND FACT VERIFICATION

Inspect the actual contents of every accessible attachment before generating facts.

1. Read relevant text, tables, diagrams, captions, maps, timelines, examples and scanned pages wherever accessible.
2. Extract relevant information from the supplied source without silently rewriting its meaning.
3. Identify gaps in the source and research those gaps using reliable web sources when browsing is available.
4. Prefer NCERT, official government publications, official educational resources and reputable academic references.
5. Cross-check important dates, numbers, names, definitions, geographical facts and potentially disputed claims.
6. Do not invent facts, sources, previous-year questions or exam-frequency claims.
7. If a fact cannot be verified adequately, exclude it rather than guessing.
8. Use attachments and external research as evidence for your internal reasoning only.

FINAL OUTPUT RULE:
Return clean factual knowledge without source labels, URLs, citations, source titles, research notes or explanations of where the information came from.

Do not claim to have read inaccessible attachments or performed web research when those capabilities were unavailable.

## STAGE 2 — SELECT MCQ-WORTHY FACTS
Think like an SSC CHSL question setter.

Prioritize:
- Names, dates, places, people, organizations, discoveries, and important events.
- Definitions, terminology, classifications, and distinguishing characteristics.
- Sequences, chronology, cause-and-effect relationships explicitly supported by the source.
- Important examples, exceptions, numerical facts, formulas, rules, and applications.
- Comparisons and commonly confusable concepts.
- Facts that support direct recall, matching, statement evaluation, ordering, classification, or identification MCQs.

Exclude:
- Repetitive explanations.
- Irrelevant narrative.
- Unsupported claims.
- Speculative interpretations.
- Details unrelated to the selected curriculum.
- Claims of previous-year exam appearance or exam frequency unless verifiable evidence is supplied.

Do not treat every textbook sentence as equally important.
Do not discard a testable fact merely because it appears inside a paragraph.

## STAGE 3 — WRITE HIGH-QUALITY BULLET POINTS
Each bullet must be concise, specific, self-contained, and useful for answering an MCQ.

Rules:
1. State the exact fact and its answer-bearing detail.
2. Preserve the relationship between entities, dates, locations, and events.
3. Use standard subject terminology.
4. Avoid vague statements and textbook-style paragraphs.
5. Do not combine unrelated facts into one bullet.
6. Do not split one fact into redundant bullets.
7. Preserve qualifications for uncertain, disputed, or interpretative claims.
8. Do not invent facts, dates, names, examples, exceptions, or numerical values.
9. Prefer facts that can be tested unambiguously.
10. Do not add unsupported superlatives such as "first", "largest", "oldest", or "only".

## STAGE 4 — CLASSIFY INTO LEARNING UNITS
Assign each fact to the single most appropriate existing Learning Unit.

Use the unit's meaning and intended scope, not keyword matching alone.

- Reuse existing units whenever the fact fits their scope.
- Do not create a new unit merely because a fact is new.
- Propose a new unit only when important, source-supported content cannot reasonably fit any existing unit.
- Give every new unit a unique mock_id such as "new_lu_1".
- Use that exact mock_id in every associated record and pattern.
- Do not assign the same fact to multiple units merely to increase coverage.

## STAGE 5 — FILL KNOWLEDGE GAPS

After inspecting the attachment, examine every supplied learning unit for missing or insufficient information.

1. Research uncovered or inadequately covered units individually when web browsing is available.
2. Prioritize NCERT, official government publications, official educational resources and reputable academic references.
3. Cross-check important facts against reliable sources.
4. Select accurate, high-yield facts suitable for SSC CHSL and comparable competitive examinations.
5. Include relevant definitions, classifications, dates, locations, numerical values, examples, exceptions, comparisons and cause-and-effect relationships.
6. Do not invent facts or claim that a question appeared in a previous-year examination without evidence.
7. Do not add unrelated facts merely to fill a learning unit.
8. If reliable information is unavailable, leave the unit's bullet_points array empty rather than guessing.
9. Verify facts internally before returning the result.

Do not include source labels such as [ATTACHMENT] or [WEB-VERIFIED].
Do not include URLs, citations, source titles or bibliographies in the final JSON.
Do not explain the research process in the final output.

## STAGE 6 — KNOWLEDGE RECORD CREATION

Create exactly one knowledge record for every learning unit supplied in EXISTING LEARNING UNITS.

1. Use the exact existing learning unit ID in learning_unit_id.
2. Create one record per supplied unit, including units for which no reliable facts are available.
3. Combine all directly relevant, accurate and deduplicated facts in content.bullet_points.
4. Each bullet must express a clear, self-contained, testable fact.
5. Preserve important names, dates, numbers, units, definitions, classifications, sequences, locations and relationships.
6. Include verified facts from the attachment and reliable external research when relevant.
7. Do not include source labels, links, citations, source titles or provenance notes in bullet_points.
8. If no reliable relevant facts are available, use an empty bullet_points array.
9. Propose a new learning unit only when important content genuinely cannot fit an existing unit.
10. Give each proposed new unit a unique mock_id and create exactly one corresponding record.
11. Use record_type "fact" for factual knowledge records.
12. Do not create duplicate records for the same learning unit.
13. Generate question patterns only when the associated record contains sufficient factual information to support them.

## STAGE 7 — DESIGN EXAM-QUALITY MCQ PATTERNS

Create reusable question-generation patterns grounded in the facts stored in each knowledge record.

Do not restrict each learning unit to one pattern. Create enough distinct patterns to cover its important facts and concepts without unnecessary duplication.

Choose patterns according to the available evidence, including:

- Direct factual recall.
- Definitions and terminology.
- Match the following.
- Correct or incorrect statements.
- Multiple-statement evaluation.
- Chronological or sequential ordering.
- Geographical location and identification.
- Classification and differentiation.
- Numerical facts and comparisons.
- Cause-and-effect relationships supported by facts.
- Application of facts in a new question context.

Requirements:

1. Each pattern must test a distinct knowledge operation.
2. Avoid multiple patterns that merely reword the same question.
3. Do not force every pattern type into every learning unit.
4. Every pattern must reference a valid existing learning unit ID or a proposed unit mock_id.
5. Every pattern must have a unique mock_id across the output.
6. Use "SSC_CHSL" in generation_rules.target_exams.
7. Make example_pattern a reusable question template, not merely a description of the topic.
8. Ground each pattern in facts from its associated knowledge record.
9. Do not generate patterns for records with empty bullet_points.
10. Do not invent facts, answer keys or misleading factual claims to make questions harder.
11. Distractors may be plausible alternatives, but the correct answer must be unambiguously supported by the recorded facts.
12. Include patterns for important facts that would otherwise be overlooked.
13. Prefer meaningful coverage and accuracy over maximizing the number of patterns.
14. Do not include source labels, URLs, citations or provenance information in pattern fields.

## STAGE 8 — DIFFICULTY PROFILES

For every proposed pattern, create exactly three profiles:

- easy
- moderate
- hard

Difficulty definitions:

- easy: Tests one explicit fact using direct recall or straightforward identification.
- moderate: Requires comparing related facts, matching multiple entities, applying a classification, or evaluating a small set of statements.
- hard: Requires integrating multiple relevant facts, carefully evaluating several statements, distinguishing closely related concepts, or solving a supported multi-step question.

Difficulty must come from the knowledge operation and the evidence required, not obscure wording, trick phrasing or unsupported assumptions.

A hard profile must not simply describe an easy question with more complicated wording.

The profile must accurately describe the actual cognitive work required. Do not assign complexity scores arbitrarily just to make a question appear difficult.

Each profile must include:
- pattern_mock_id
- level
- steps_required
- concept_count
- calculation_complexity
- wording_complexity
- decoding_complexity
- target_time_seconds
- generation_constraints

Complexity fields must be integers from 1 to 5.
steps_required, concept_count, and target_time_seconds must be sensible integers.
Use only the allowed level values: "easy", "moderate", "hard".

## STRICT OUTPUT SCHEMA
Return exactly one valid JSON object with these four top-level keys:
- proposedLearningUnits
- proposedRecords
- proposedPatterns
- proposedProfiles

Use these structures:

{
  "proposedLearningUnits": [
    {
      "mock_id": "new_lu_1",
      "name": "Specific New Learning Unit",
      "description": "Scope of the new unit."
    }
  ],
  "proposedRecords": [
    {
      "learning_unit_id": "EXACT_EXISTING_ID_OR_NEW_UNIT_MOCK_ID",
      "record_type": "fact",
      "title": "Concise, descriptive title",
      "content": {
        "bullet_points": [
          "One precise, high-yield fact."
        ]
      }
    }
  ],
  "proposedPatterns": [
    {
      "learning_unit_id": "EXACT_EXISTING_ID_OR_NEW_UNIT_MOCK_ID",
      "mock_id": "p1",
      "name": "Specific MCQ Pattern",
      "description": "What the pattern tests.",
      "easy_definition": "Direct recall of one fact.",
      "moderate_definition": "Contextual recall or comparison.",
      "hard_definition": "Multi-fact reasoning supported by the source.",
      "example_pattern": "A reusable question template based on extracted knowledge.",
      "generation_rules": {
        "pattern_type": "Fact Retrieval",
        "target_exams": ["SSC_CHSL"]
      },
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
      "generation_constraints": {
        "wording": "direct",
        "factual_grounding": "Use only the extracted knowledge."
      }
    }
  ]
}

The above objects illustrate the required structure. Populate all arrays with the appropriate data.
If no new Learning Units are justified, use an empty proposedLearningUnits array.
Generate exactly four top-level keys. Do not add source labels, URLs, citations, source titles, confidence scores, comments, explanations, or extra fields.

## FINAL VALIDATION — REQUIRED

Before returning the JSON, verify all of the following:

1. Every accessible attachment was inspected to the extent possible.
2. Web research was performed only if browsing was available.
3. Every supplied learning unit was checked for relevant, useful facts.
4. Facts are accurate, directly relevant, concise, self-contained and deduplicated.
5. Uncovered learning units were researched when browsing was available.
6. No unsupported facts were invented to fill knowledge gaps.
7. No source labels, URLs, citations, source titles or provenance notes appear in the final output.
8. Exactly one knowledge record exists for each supplied existing learning unit.
9. Every proposed new learning unit has exactly one corresponding record.
10. Every record and pattern references a valid learning unit ID or proposed unit mock_id.
11. Every pattern mock_id is unique.
12. Every proposed pattern has exactly three profiles: easy, moderate and hard.
13. Every profile references the correct pattern_mock_id.
14. All required fields and permitted values follow the specified schema.
15. Complexity fields are integers from 1 to 5.
16. No pattern is generated from an empty knowledge record.
17. Each pattern is grounded in the facts of its associated record.
18. The JSON parses successfully.
19. The output contains exactly the four required top-level keys.
20. No text appears outside the JSON object.

If reliable evidence is insufficient, leave the affected record's bullet_points array empty. Never fabricate facts to make the output appear complete.

Now inspect the accessible attachments, audit the supplied learning units, research missing knowledge when browsing is available, create clean factual records and distinct exam-quality question patterns, and return only the completed JSON object.`;

    navigator.clipboard.writeText(promptText);
    alert('Prompt copied! The AI is now instructed to generate ONE record per valid Learning Unit.');
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
        .replace(/\\$/gm, '')      
        .replace(/\\\n/g, '\n')    
        .replace(/&#x20;/g, ' ')   
        .replace(/&nbsp;/g, ' ')   
        .trim();

      // Fix for Turbopack string parsing bug: use unicode representation for backticks
      cleanedPassage = cleanedPassage.replace(/^\u0060\u0060\u0060(json)?\n?/i, '').replace(/\n?\u0060\u0060\u0060$/i, '').trim();
      
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
    const existingUnit = allUnits.find(u => u.id === id);
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

      // 1. Insert proposed learning units
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

      // --- VALIDATION HELPER ---
      const validateUnitId = (originalId: string) => {
        const mappedId = unitIdMap[originalId] || originalId;
        const existsInDB = allUnits.some(u => u.id === mappedId);
        const isNewlyCreated = Object.values(unitIdMap).includes(mappedId);
        
        if (!existsInDB && !isNewlyCreated) {
          throw new Error(`The AI generated an invalid Learning Unit ID: "${originalId}". It does not match any existing or newly proposed units. Please fix the JSON in the text area.`);
        }
        return mappedId;
      };

      // 2. Strictly filter and insert knowledge records
      if (proposedRecords.length > 0) {
        const recordsToInsert = proposedRecords.map(r => ({ 
          learning_unit_id: validateUnitId(r.learning_unit_id),
          record_type: r.record_type,
          title: r.title,
          content: r.content,
          verification_status: 'verified' 
        }));
        const { error: krError } = await supabase.from('knowledge_records').insert(recordsToInsert);
        if (krError) throw krError;
      }

      // 3. Strictly filter and insert question patterns & profiles
      for (const pattern of proposedPatterns) {
        const mappedUnitId = validateUnitId(pattern.learning_unit_id);

        const cleanPatternData = {
          learning_unit_id: mappedUnitId,
          name: pattern.name,
          description: pattern.description,
          easy_definition: pattern.easy_definition,
          moderate_definition: pattern.moderate_definition,
          hard_definition: pattern.hard_definition,
          example_pattern: pattern.example_pattern,
          generation_rules: pattern.generation_rules,
          required_operations: pattern.required_operations,
          active: true
        };

        const { data: newPattern, error: pError } = await supabase
          .from('question_patterns')
          .insert(cleanPatternData)
          .select()
          .single();
        
        if (pError) throw pError;

        const profilesToInsert = proposedProfiles
          .filter(prof => prof.pattern_mock_id === pattern.mock_id)
          .map(profData => ({
            question_pattern_id: newPattern.id,
            level: profData.level,
            steps_required: profData.steps_required,
            concept_count: profData.concept_count,
            calculation_complexity: profData.calculation_complexity,
            wording_complexity: profData.wording_complexity,
            decoding_complexity: profData.decoding_complexity,
            target_time_seconds: profData.target_time_seconds,
            generation_constraints: profData.generation_constraints
          }));

        if (profilesToInsert.length > 0) {
          const { error: dpError } = await supabase.from('difficulty_profiles').insert(profilesToInsert);
          if (dpError) throw dpError;
        }
      }

      alert("Successfully saved mapped data (including new Learning Units) to the curriculum database!");
      
      setProposedLearningUnits([]);
      setProposedRecords([]);
      setProposedPatterns([]);
      setProposedProfiles([]);
      setPassage('');
      
      // Refresh the tree to instantly hide the completed subtopic if necessary
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
          <h1 className="text-3xl font-extrabold text-slate-900">Knowledge Studio</h1>
          <p className="text-slate-500 mt-1">Extract, review, and map textbook passages directly to pending units.</p>
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
            <h2 className="font-semibold text-lg">Curriculum Target
            {loadingTree && <span className="ml-2 text-xs text-blue-600 font-normal animate-pulse">Syncing...</span>}
            </h2>
          </div>
          
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50" value={subjectId} onChange={e => setSubjectId(e.target.value)} disabled={loadingTree}>
            <option value="">Select Subject...</option>
            {activeSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50" value={topicId} onChange={e => setTopicId(e.target.value)} disabled={!subjectId || loadingTree}>
            <option value="">Select Topic...</option>
            {activeTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="border border-slate-300 p-2.5 rounded-lg bg-slate-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all disabled:opacity-50" value={subtopicId} onChange={e => setSubtopicId(e.target.value)} disabled={!topicId || loadingTree}>
            <option value="">Select Subtopic...</option>
            {activeSubtopics.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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