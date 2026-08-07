process.env.DATABASE_URL = "file:./dev.db";
const { PrismaClient } = require('@prisma/client');
const xlsx = require('xlsx');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const filePath = path.join('..', 'Horário Escolar 2026.xlsx');
  const workbook = xlsx.readFile(filePath);

  console.log("Iniciando importação...");

  // Para garantir que não haja duplicatas caso rodemos o script várias vezes
  await prisma.schedule.deleteMany();
  await prisma.curriculum.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.class.deleteMany();
  await prisma.subject.deleteMany();

  const teachersMap = new Map(); // name -> id
  const subjectsMap = new Map(); // name -> id
  const classesMap = new Map(); // name -> id

  const getOrCreateTeacher = async (name, type) => {
    if (!name) return null;
    let tName = name.trim();
    if (!teachersMap.has(tName)) {
      const teacher = await prisma.teacher.create({
        data: { name: tName, type }
      });
      teachersMap.set(tName, teacher.id);
    }
    return teachersMap.get(tName);
  };

  const getOrCreateSubject = async (name) => {
    if (!name) return null;
    let sName = name.trim();
    if (!subjectsMap.has(sName)) {
      const subject = await prisma.subject.create({
        data: { name: sName }
      });
      subjectsMap.set(sName, subject.id);
    }
    return subjectsMap.get(sName);
  };

  const getOrCreateClass = async (name, shift, level, regenteName = null) => {
    if (!name) return null;
    let cName = name.trim();
    if (!classesMap.has(cName)) {
      const cls = await prisma.class.create({
        data: { name: cName, shift, level, regenteName }
      });
      classesMap.set(cName, cls.id);
    }
    return classesMap.get(cName);
  };

  // Nomes das turmas com turnos (simplificado)
  const shiftMap = {
    "Maternal": "MORNING", "Jardim": "MORNING", "Pré": "MORNING", 
    "1º ano": "MORNING", "2º ano": "MORNING", "3º ano": "MORNING", 
    "4º ano A": "MORNING", "5º ano A": "MORNING", "6º ano A": "MORNING",
    "4º ano B": "AFTERNOON", "5º ano B": "AFTERNOON", "6º ano B": "AFTERNOON",
    "7º ano": "MORNING", "8º ano": "MORNING", "9º ano": "MORNING"
  };

  const levelMap = {
    "Maternal": "INFANTIL", "Jardim": "INFANTIL", "Pré": "INFANTIL",
    "1º ano": "FUND1", "2º ano": "FUND1", "3º ano": "FUND1",
    "4º ano A": "FUND1", "4º ano B": "FUND1", "5º ano A": "FUND1", "5º ano B": "FUND1",
    "6º ano A": "FUND2", "6º ano B": "FUND2", "7º ano": "FUND2", "8º ano": "FUND2", "9º ano": "FUND2"
  };

  for (const sheetName of workbook.SheetNames) {
    console.log(`Processando aba: ${sheetName}`);
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    if (data.length < 5) continue;

    const classInfoRow = data[1];
    if (!classInfoRow || !classInfoRow[1]) continue;

    const classInfoStr = classInfoRow[1].toString(); // ex: "6º ano A - Manhã\nProfessor..." ou algo assim
    let regenteName = null;
    
    // Tentando extrair o professor regente
    if (classInfoStr.includes("Professor")) {
      const parts = classInfoStr.split("\n");
      for(const p of parts) {
        if(p.toLowerCase().includes("professor")) {
          regenteName = p.replace(/Professor[a-z]?:\s*/i, '').trim();
        }
      }
    }

    const shift = shiftMap[sheetName] || "MORNING";
    const level = levelMap[sheetName] || "FUND1";
    
    const classId = await getOrCreateClass(sheetName, shift, level, regenteName);

    if (regenteName) {
       await getOrCreateTeacher(regenteName, "REGENTE");
    }

    // Leitura da grade de horários
    const days = [1, 2, 3, 4, 5]; // Segunda a Sexta
    let periodIndex = 1;

    for (let i = 5; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;
      
      const periodName = (row[0] || "").toString().toUpperCase();
      if (periodName.includes("INTERVALO")) continue;
      if (!periodName.includes("ª")) continue; // Pular se não for "1ª", "2ª", etc.

      for (let dayIndex = 1; dayIndex <= 5; dayIndex++) {
        const cellData = row[dayIndex];
        if (!cellData) continue;
        
        let subjectName = cellData.toString().trim();
        let teacherName = regenteName; // default to regente se não especificado
        let isAulista = false;

        // Se a célula contiver quebra de linha (ex: Geografia\n(profª Fabiana))
        if (subjectName.includes("\n")) {
          const parts = subjectName.split("\n");
          subjectName = parts[0].trim();
          let rawTeacher = parts[1].trim();
          if (rawTeacher.startsWith("(")) rawTeacher = rawTeacher.replace(/\(/g, "").replace(/\)/g, "");
          rawTeacher = rawTeacher.replace(/profº /gi, "").replace(/profª /gi, "").replace(/prof. /gi, "").trim();
          teacherName = rawTeacher;
          isAulista = true;
        }

        const subjectId = await getOrCreateSubject(subjectName);
        let teacherId = null;

        if (teacherName) {
           teacherId = await getOrCreateTeacher(teacherName, isAulista ? "AULISTA" : "REGENTE");
        }

        const isFixed = subjectName.toLowerCase().includes("capela");

        // Aqui, para simplificar a importação inicial, apenas adicionaremos os dados como Schedule Fixo ou Curriculum
        // Na prática, vamos salvar em Curriculum para não criar os Schedules antes da geração
        if (subjectId) {
          const existingCurriculum = await prisma.curriculum.findFirst({
            where: { classId, subjectId }
          });
          
          if (existingCurriculum) {
             await prisma.curriculum.update({
               where: { id: existingCurriculum.id },
               data: { classesPerWeek: existingCurriculum.classesPerWeek + 1, teacherId }
             });
          } else {
             await prisma.curriculum.create({
               data: { classId, subjectId, teacherId, classesPerWeek: 1 }
             });
          }

          // Cadastra o schedule para todas as matérias
          await prisma.schedule.create({
            data: {
              classId, subjectId, teacherId, dayOfWeek: dayIndex, period: periodIndex, isFixed
            }
          });
        }
      }
      periodIndex++;
    }
  }

  console.log("Importação concluída com sucesso!");
}

main().catch(e => {
  console.error("Erro fatal:", e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
