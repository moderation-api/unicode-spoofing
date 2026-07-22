export { analyze, FORMAT_CHAR_SCRIPTS, ZALGO_MARK_RUN, ZERO_WIDTH_INERT_RUN } from './analyze';
export { confusableLookalikes, skeleton } from './confusables';
export {
  EVASION_SCORE_THRESHOLD,
  findKeywordEvasions,
  LEET_ALTERNATIVES,
  LEET_SEQUENCES,
  prefilter,
  type KeywordEvasionMatch,
} from './leet';
export { UNICODE_VERSION, DATA_DATE } from './data/confusables.generated';
export {
  LEGITIMATE_SCRIPT_COMBINATIONS,
  primaryScript,
  PSEUDO_SCRIPTS,
  SCRIPT_NAMES,
  SUPPORTED_SCRIPTS,
  type PseudoScript,
  type ScriptName,
} from './scripts';
export {
  SPOOF_SIGNALS,
  SPOOFING_SIGNALS,
  type AnalysisResult,
  type AnalyzeOptions,
  type SpoofSignal,
  type WordFinding,
} from './types';
