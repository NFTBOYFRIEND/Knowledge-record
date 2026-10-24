export interface Subject {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  active: boolean;
  created_at: string;
}

export interface Topic {
  id: string;
  subject_id: string;
  name: string;
  description: string | null;
  sequence: number | null;
  active: boolean;
  created_at: string;
}

export interface Subtopic {
  id: string;
  topic_id: string;
  name: string;
  description: string | null;
  sequence: number | null;
  active: boolean;
  created_at: string;
}

export interface LearningUnit {
  id: string;
  subtopic_id: string;
  name: string;
  description: string | null;
  concept_notes: string | null;
  rules: string | null;
  prerequisites: any | null; // jsonb
  sequence: number | null;
  active: boolean;
  created_at: string;
}

export interface KnowledgeRecord {
  id: string;
  learning_unit_id: string;
  record_type: 'formula' | 'definition' | 'fact' | 'rule' | 'method' | 'example' | 'explanation' | 'other';
  title: string;
  content: any; // jsonb
  source_reference: string | null;
  verification_status: 'pending' | 'verified' | 'disputed' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface QuestionPattern {
  id: string;
  learning_unit_id: string;
  name: string;
  description: string | null;
  generation_rules: any | null; // jsonb
  required_operations: any | null; // jsonb
  easy_definition: string | null;
  moderate_definition: string | null;
  hard_definition: string | null;
  example_pattern: string | null;
  active: boolean;
  created_at: string;
  generation_contract: any | null; // jsonb
}

export interface DifficultyProfile {
  id: string;
  question_pattern_id: string;
  level: 'easy' | 'moderate' | 'hard';
  steps_required: number | null;
  concept_count: number | null;
  calculation_complexity: number | null;
  wording_complexity: number | null;
  decoding_complexity: number | null;
  target_time_seconds: number | null;
  generation_constraints: any | null; // jsonb
  created_at: string;
}