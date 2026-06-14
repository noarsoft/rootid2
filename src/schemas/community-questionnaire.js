const COMMUNITY_QUESTIONNAIRE = {
  id: "community-local-identity-questionnaire",
  name: "แบบสอบถามเก็บข้อมูลรายการชุมชน",
  version: "1.0.0",
  language: "th",
  share_mode: "all",
  description:
    "แบบสอบถามสำหรับเก็บข้อมูลรายการสินค้า บริการ องค์ความรู้ สถานที่ กิจกรรม หรือทรัพยากรทางวัฒนธรรมของชุมชน",
  sections: [
    {
      id: "identity",
      title: "1) ข้อมูลระบุตัวรายการ",
      fields: [
        {
          key: "identity_name",
          label: "1.1 ชื่ออัตลักษณ์ท้องถิ่น",
          type: "string",
          required: true,
          placeholder: "เช่น จิกจ้อง, นวดแผนไทย, วัดประจำชุมชน",
        },
        {
          key: "identity_description",
          label: "1.2 คำอธิบายอัตลักษณ์ท้องถิ่นสั้น ๆ",
          type: "string",
          multiline: true,
          rows: 3,
        },
        {
          key: "community_name",
          label: "1.3 ชื่อชุมชน หรือ ชื่อกลุ่มรัฐวิสากิจชุมชน",
          type: "string",
          required: true,
        },
      ],
    },
    {
      id: "category",
      title: "2) ประเภทอัตลักษณ์ท้องถิ่น",
      fields: [
        {
          key: "identity_category",
          label: "2.1 ประเภท",
          type: "dropdown",
          required: true,
          options: [
            { label: "สินค้า", value: "product" },
            { label: "บริการ", value: "service" },
            { label: "องค์ความรู้", value: "knowledge" },
            { label: "สถานที่", value: "place" },
            { label: "กิจกรรม", value: "activity" },
          ],
        },
      ],
    },
    {
      id: "usage",
      title: "3) การใช้งาน",
      fields: [
        {
          key: "main_usage",
          label: "3.1 การใช้งานหลัก",
          type: "ranking",
          required: true,
          rankMin: 1,
          rankMax: 3,
          options: [
            { label: "สุขภาพ", value: "health" },
            { label: "การท่องเที่ยว", value: "tourism" },
            { label: "ชีวิตประจำวัน", value: "daily_life" },
            { label: "การค้า", value: "commerce" },
            { label: "การศึกษา", value: "education" },
            { label: "พิธีกรรม", value: "ritual" },
            { label: "การสื่อความหมายทางวัฒนธรรม", value: "cultural_meaning" },
            { label: "อื่นๆ", value: "other" },
          ],
          note:
            "ให้จัดลำดับความสำคัญ 1 = สำคัญที่สุด, 2 = สำคัญรองลงมา, 3 = สำคัญน้อยที่สุด",
        },
      ],
    },
    {
      id: "target_audience",
      title: "4) กลุ่มเป้าหมาย",
      fields: [
        {
          key: "target_audience",
          label: "4.1 กลุ่มเป้าหมายหลักของสินค้า หรือ บริการ",
          type: "ranking",
          required: true,
          rankMin: 1,
          rankMax: 3,
          options: [
            { label: "นักท่องเที่ยวไทย", value: "thai_tourists" },
            { label: "นักท่องเที่ยวต่างชาติ", value: "foreign_tourists" },
            { label: "คนท้องถิ่น", value: "local_people" },
            { label: "ภาคธุรกิจ", value: "business_sector" },
            { label: "หน่วยงานรัฐบาล", value: "government" },
            { label: "หน่วยงานเอกชน", value: "private_sector" },
            { label: "ชุมชน", value: "community" },
            { label: "เยาวชน", value: "youth" },
            { label: "ผู้สูงอายุ", value: "elderly" },
            { label: "คนทั่วไป", value: "general_public" },
            { label: "ผู้เรียนรู้", value: "learners" },
            { label: "อื่นๆ", value: "other" },
          ],
          note:
            "ให้จัดลำดับความสำคัญ 1 = สำคัญที่สุด, 2 = สำคัญรองลงมา, 3 = สำคัญน้อยที่สุด",
        },
      ],
    },
    {
      id: "resource_base",
      title: "5) ฐานทรัพยากร",
      fields: [
        {
          key: "resource_base",
          label: "5.1 ฐานทรัพยากรหลัก",
          type: "ranking",
          required: true,
          rankMin: 1,
          rankMax: 3,
          options: [
            { label: "สมุนไพร", value: "herbs" },
            { label: "วัสดุธรรมชาติ", value: "natural_materials" },
            { label: "ทรัพยากรท้องถิ่น", value: "local_resources" },
            { label: "สถานที่", value: "location" },
            { label: "แรงงานฝีมือ", value: "skilled_labor" },
            { label: "องค์ความรู้ชุมชน", value: "community_knowledge" },
            { label: "อื่นๆ", value: "other" },
          ],
          note:
            "ให้จัดลำดับความสำคัญ 1 = สำคัญที่สุด, 2 = สำคัญรองลงมา, 3 = สำคัญน้อยที่สุด",
        },
      ],
    },
    {
      id: "delivery",
      title: "6) รูปแบบการส่งมอบ",
      fields: [
        {
          key: "delivery_format",
          label: "6.1 ต้องการให้ผลิตหรือปรับปรุงสินค้าหรือบริการให้ออกมาในรูปแบบใด",
          type: "ranking",
          required: true,
          rankMin: 1,
          rankMax: 3,
          options: [
            { label: "สินค้า", value: "product" },
            { label: "บริการ", value: "service" },
            { label: "สถานที่", value: "place" },
            { label: "กิจกรรม", value: "activity" },
            { label: "ความรู้", value: "knowledge" },
            { label: "สื่อ/ระบบดิจิทัล", value: "digital_media_system" },
            { label: "อื่นๆ", value: "other" },
          ],
          note:
            "ให้จัดลำดับความสำคัญ 1 = สำคัญที่สุด, 2 = สำคัญรองลงมา, 3 = สำคัญน้อยที่สุด",
        },
      ],
    },
    {
      id: "identity_level",
      title: "7) การประเมินระดับของอัตลักษณ์",
      fields: [
        {
          key: "locality_level",
          label: "7.1 ระดับความเป็นท้องถิ่น",
          type: "dropdown",
          required: true,
          options: [
            { label: "ไม่มี", value: "none" },
            { label: "ต่ำ", value: "low" },
            { label: "ปานกลาง", value: "medium" },
            { label: "สูง", value: "high" },
          ],
        },
        {
          key: "traditional_level",
          label: "7.2 ระดับความเป็นดั้งเดิม",
          type: "dropdown",
          required: true,
          options: [
            { label: "ไม่มี", value: "none" },
            { label: "ต่ำ", value: "low" },
            { label: "ปานกลาง", value: "medium" },
            { label: "สูง", value: "high" },
          ],
        },
        {
          key: "modern_adaptation_level",
          label: "7.3 ระดับการประยุกต์สมัยใหม่",
          type: "dropdown",
          required: true,
          options: [
            { label: "ไม่มี", value: "none" },
            { label: "ต่ำ", value: "low" },
            { label: "ปานกลาง", value: "medium" },
            { label: "สูง", value: "high" },
          ],
        },
        {
          key: "publication_level",
          label: "7.4 ระดับการเผยแพร่",
          type: "dropdown",
          required: true,
          options: [
            { label: "ไม่มี", value: "none" },
            { label: "ต่ำ", value: "low" },
            { label: "ปานกลาง", value: "medium" },
            { label: "สูง", value: "high" },
          ],
        },
      ],
    },
    {
      id: "production_method",
      title: "8) วิธีการผลิตหลัก",
      fields: [
        {
          key: "production_method",
          label: "8.1 วิธีการผลิตหลัก",
          type: "dropdown",
          required: true,
          options: [
            { label: "ทำด้วยมือ", value: "handmade" },
            { label: "ผลิตเชิงช่าง", value: "craft_production" },
            { label: "บริการโดยผู้เชี่ยวชาญ / จ้างผู้ผลิตอื่น", value: "outsourced_service" },
            { label: "จัดกิจกรรม", value: "event" },
            { label: "อื่นๆ", value: "other" },
          ],
        },
      ],
    },
    {
      id: "access_channels",
      title: "9) ช่องทางการเข้าถึงหลัก",
      fields: [
        {
          key: "access_channels",
          label: "9.1 สามารถเข้าถึงสินค้าหรือบริการได้ทางใดเป็นหลัก",
          type: "ranking",
          required: true,
          rankMin: 1,
          rankMax: 3,
          options: [
            { label: "ช่องทางออนไลน์", value: "online" },
            { label: "ช่องทางออฟไลน์ เช่น ขายตรง ขายหน้าร้าน", value: "offline" },
            { label: "สอนหรือจากการทำเวิร์กช็อปกลุ่ม", value: "workshop" },
            { label: "แหล่งท่องเที่ยว", value: "tourist_attraction" },
            { label: "ชุมชน เช่น OTOP", value: "community_channel" },
            { label: "หน่วยงานรัฐ เช่น ออกบูธ", value: "government_channel" },
            { label: "อื่นๆ", value: "other" },
          ],
          note:
            "ให้จัดลำดับความสำคัญ 1 = สำคัญที่สุด, 2 = สำคัญรองลงมา, 3 = สำคัญน้อยที่สุด",
        },
      ],
    },
    {
      id: "support",
      title: "10) การสนับสนุน",
      fields: [
        {
          key: "support_sources",
          label: "10.1 สินค้าหรือบริการได้รับการสนับสนุนจากหน่วยงานใดบ้าง",
          type: "multiselect",
          multiple: true,
          options: [
            { label: "ไม่มี", value: "none" },
            { label: "ภาครัฐสนับสนุน", value: "government" },
            { label: "ชุมชนสนับสนุน", value: "community" },
            { label: "เอกชนสนับสนุน", value: "private_sector" },
            { label: "สถาบันการศึกษาสนับสนุน", value: "education" },
            { label: "อื่นๆ", value: "other" },
          ],
        },
      ],
    },
    {
      id: "keywords",
      title: "11) คำสำคัญ",
      fields: [
        {
          key: "keywords",
          label: "11.1 คำสำคัญ",
          type: "string",
          multiline: true,
          rows: 2,
          placeholder: "ร่ม;นวด;สมุนไพร;หัตถกรรม",
          note: "ใส่คำสำคัญโดยคั่นด้วยเครื่องหมาย ;",
        },
      ],
    },
    {
      id: "main_category",
      title: "12) หมวดหมู่หลักของอัตลักษณ์",
      fields: [
        {
          key: "main_category",
          label: "12.1 หมวดหมู่หลักของอัตลักษณ์นี้",
          type: "ranking",
          required: true,
          rankMin: 1,
          rankMax: 5,
          options: [
            { label: "โบราณสถานและเมืองนิเวศ", value: "heritage_ecosystem" },
            { label: "วิถีชีวิตและรูปแบบการดำเนินชีวิต", value: "way_of_life" },
            { label: "เรื่องเล่าและสัญลักษณ์", value: "narrative_symbol" },
            { label: "ประเพณีและวัฒนธรรม", value: "tradition_culture" },
            { label: "อาหาร สปา และสมุนไพรพื้นบ้าน", value: "food_spa_herbs" },
            { label: "คุณค่า ความเชื่อและภูมิปัญญา", value: "values_belief_wisdom" },
            { label: "งานฝีมือและผลิตภัณฑ์ชุมชน", value: "crafts_community_products" },
            { label: "สัญลักษณ์และชนเผ่าพื้นเมือง", value: "symbols_indigenous" },
            { label: "ความโดดเด่นทางวัฒนธรรม และสถาปัตยกรรม", value: "culture_architecture" },
            { label: "ทุนทรัพยากรดั้งเดิม", value: "traditional_resources" },
            { label: "องค์ความรู้สินค้าหัตถกรรม", value: "craft_knowledge" },
          ],
          note:
            "ให้ใส่ลำดับความสำคัญอันดับ 5 อันดับ จาก 1 (มาก) - 5 (น้อย)",
        },
      ],
    },
    {
      id: "attachments",
      title: "13) รูปภาพประกอบ",
      fields: [
        {
          key: "attachments",
          label: "13.1-13.3 รูปภาพประกอบ",
          type: "multipleupload",
          multiple: true,
          allowedTypes: ["image/*"],
          note: "แนบรูปภาพได้หลายไฟล์",
        },
      ],
    },
  ],
};

function flattenFields(sections = []) {
  return sections.flatMap((section) => section.fields || []);
}

function normalizeSchemaFieldType(fieldType) {
  const type = String(fieldType || "").trim().toLowerCase();

  if (type === "ranking") return "dropdown";
  if (type === "multiselect") return "dropdown";

  return type;
}

function toSchemaPayload(questionnaire = COMMUNITY_QUESTIONNAIRE) {
  const payload = {};

  flattenFields(questionnaire.sections).forEach((field, index) => {
    const normalizedType = normalizeSchemaFieldType(field.type);

    payload[field.key] = {
      type: normalizedType,
      label: field.label,
      required: Boolean(field.required),
      _order: index + 1,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.rows ? { rows: field.rows } : {}),
      ...(field.multiple ? { multiple: true } : {}),
      ...(field.options ? { enum: field.options } : {}),
      ...(field.allowedTypes ? { allowedTypes: field.allowedTypes } : {}),
      ...(field.rankMin !== undefined ? { rankMin: field.rankMin } : {}),
      ...(field.rankMax !== undefined ? { rankMax: field.rankMax } : {}),
      ...(field.note ? { description: field.note } : {}),
    };
  });

  return {
    name: questionnaire.name,
    description: questionnaire.description,
    share_mode: questionnaire.share_mode || "all",
    payload,
  };
}

module.exports = COMMUNITY_QUESTIONNAIRE;
module.exports.COMMUNITY_QUESTIONNAIRE = COMMUNITY_QUESTIONNAIRE;
module.exports.flattenFields = flattenFields;
module.exports.toSchemaPayload = toSchemaPayload;
