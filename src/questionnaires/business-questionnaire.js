const BUSINESS_QUESTIONNAIRE = {
  id: "community-local-identity-business-questionnaire",
  name: "แบบสอบถามข้อมูลหน่วยงาน/ธุรกิจชุมชน",
  version: "1.0.0",
  language: "th",
  share_mode: "all",
  description:
    "แบบสอบถามตั้งต้นสำหรับระบุชื่อหน่วยงาน ชุมชน หรือโปรเจกต์ ก่อนสร้าง schema รายการชุมชน",
  sections: [
    {
      id: "business_identity",
      title: "1) ข้อมูลหน่วยงาน/ธุรกิจ",
      fields: [
        {
          key: "business_name",
          label: "1.1 ชื่อหน่วยงาน/ธุรกิจ/โครงการ",
          type: "string",
          required: true,
          placeholder: "เช่น ชุมชนต้นแบบตำบล...",
        },
        {
          key: "business_icon",
          label: "1.2 ไอคอนของหน่วยงาน/ธุรกิจ",
          type: "string",
          placeholder: "เช่น 🏘️",
        },
        {
          key: "business_description",
          label: "1.3 คำอธิบายสั้น ๆ",
          type: "string",
          multiline: true,
          rows: 3,
        },
      ],
    },
  ],
};

function toQuestionnairePayload(questionnaire = BUSINESS_QUESTIONNAIRE) {
  return {
    id: questionnaire.id,
    name: questionnaire.name,
    version: questionnaire.version,
    language: questionnaire.language,
    share_mode: questionnaire.share_mode || "all",
    description: questionnaire.description,
    sections: questionnaire.sections,
  };
}

module.exports = BUSINESS_QUESTIONNAIRE;
module.exports.BUSINESS_QUESTIONNAIRE = BUSINESS_QUESTIONNAIRE;
module.exports.toQuestionnairePayload = toQuestionnairePayload;
