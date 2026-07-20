export { analyze, FORMAT_CHAR_SCRIPTS, ZALGO_MARK_RUN } from './analyze';
export { skeleton } from './confusables';
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
  type AnalysisResult,
  type AnalyzeOptions,
  type SpoofSignal,
  type WordFinding,
} from './types';
