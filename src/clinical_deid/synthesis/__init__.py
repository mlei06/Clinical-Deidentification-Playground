from clinical_deid.synthesis.align import drop_overlapping_spans, phi_dict_to_spans
from clinical_deid.synthesis.document import synthesis_result_to_annotated_document
from clinical_deid.synthesis.client import LLMClient, OpenAICompatibleChatClient, StaticResponseClient
from clinical_deid.synthesis.components import (
    CompositePromptParts,
    DefaultFewShotFormatter,
    DefaultPhiTypesFormatter,
    FewShotFormatter,
    PhiTypesFormatter,
)
from clinical_deid.synthesis.parse import parse_synthesis_response
from clinical_deid.synthesis.synthesizer import LLMSynthesizer
from clinical_deid.synthesis.presets import person_title_fewshot_rules
from clinical_deid.synthesis.template import SynthesizerPromptTemplate, default_clinical_note_synthesis_template
from clinical_deid.synthesis.types import ChatMessage, FewShotExample, SynthesisResult

__all__ = [
    "ChatMessage",
    "CompositePromptParts",
    "DefaultFewShotFormatter",
    "DefaultPhiTypesFormatter",
    "FewShotExample",
    "FewShotFormatter",
    "LLMClient",
    "LLMSynthesizer",
    "OpenAICompatibleChatClient",
    "PhiTypesFormatter",
    "person_title_fewshot_rules",
    "phi_dict_to_spans",
    "SynthesisResult",
    "SynthesizerPromptTemplate",
    "StaticResponseClient",
    "default_clinical_note_synthesis_template",
    "drop_overlapping_spans",
    "parse_synthesis_response",
    "synthesis_result_to_annotated_document",
]
