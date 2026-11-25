import { test } from "node:test";
import assert from "node:assert/strict";
import { orderDirectoryFields, directoryFormHeading, directoryDisplayIdentifier } from "../../frontend/src/lib/organizationTypes";

test("template priority uses stable keys and preserves renamed and custom fields", () => {
  const fields = [{key:"custom_a"}, {key:"section"}, {key:"student_id"}, {key:"custom_b"}, {key:"program"}];
  assert.deepEqual(orderDirectoryFields(fields, "student").map(field => field.key), ["student_id", "program", "section", "custom_a", "custom_b"]);
  assert.equal(fields[0].key, "custom_a");
  assert.deepEqual(orderDirectoryFields(fields, "other"), fields);
  assert.deepEqual(orderDirectoryFields([], "workplace"), []);
  for (const [type, keys] of [["workplace", ["employee_id", "department"]], ["club", ["membership_id", "chapter"]]] as const) {
    assert.deepEqual(orderDirectoryFields(keys.toReversed().map(key => ({key})), type).map(field => field.key), keys);
  }
  assert.equal(directoryFormHeading("student"), "Student information");
  assert.equal(directoryFormHeading(null), "Organization information");
});

test("display identifiers require active definitions and never merge generic codes", () => {
  const member = { member_code: "GEN-1", attributes: {student_id: "ST-2"} };
  assert.deepEqual(directoryDisplayIdentifier("student", [{key:"student_id",label:"Campus ID"}], member), {label:"Campus ID",value:"ST-2"});
  assert.deepEqual(directoryDisplayIdentifier("student", [], member), {label:"Member identifier",value:"GEN-1"});
  assert.equal(member.member_code, "GEN-1");
  assert.equal(directoryDisplayIdentifier("other", [], {...member,member_code:null}), null);
});

import { mapDirectoryHeaders, parseDirectoryCsv, parseDirectoryCsvWithRows, restoreDirectoryCsvCell, suggestHeaderlessStudentColumns, isPaymentImportHeader } from "../../frontend/src/utils/directorySpreadsheet";
import { quoteDirectoryCsvCell } from "../src/utils/directoryCsv";

test("directory spreadsheet headers and protected cells round trip", () => {
  assert.deepEqual(mapDirectoryHeaders(["Student ID", "Full Name", "Course", "Join Date"], [
    {key:"custom:student_id",label:"Student ID",aliases:["student_id","Student Number"]},
    {key:"display_name",label:"Full Name",aliases:["Name"]},
    {key:"custom:program",label:"Program",aliases:["Course"]},
    {key:"custom:join_date",label:"Join Date",aliases:[]},
  ]), {"custom:student_id":0,display_name:1,"custom:program":2,"custom:join_date":3});
  for (const value of ["00041", "2026-11-14", "", '=SUM(1,2)', "'=literal", 'A, "B"']) {
    const serialized = quoteDirectoryCsvCell(value);
    const parsed = parseDirectoryCsv("Value\r\n" + serialized)[1][0];
    assert.equal(restoreDirectoryCsvCell(parsed),value);
    if (value.startsWith("=")) assert.ok(parsed.startsWith("'"));
  }
});


test("CSV source row numbers include skipped empty lines and multiline names", () => {
  assert.deepEqual(parseDirectoryCsvWithRows('\r\nName,Student ID\r\n\r\n"Example,\r\nAlex",001-00001\r\nAnother,001-00002'), [
    { cells: ["Name", "Student ID"], sourceRow: 2 },
    { cells: ["Example,\r\nAlex", "001-00001"], sourceRow: 4 },
    { cells: ["Another", "001-00002"], sourceRow: 6 },
  ]);
});


test("a reordered headerless student roster suggests all five mappings", () => {
  const records = [
    ["001-00001", "CBA", "BSA", "2", "Example, Alex"],
    ["001-00002", "CBA", "BSA", "2", "Example, Sam"],
  ];
  assert.deepEqual(suggestHeaderlessStudentColumns(records), {
    display_name: 4, "custom:student_id": 0, "custom:college": 1,
    "custom:program": 2, "custom:year_level": 3,
  });
  assert.equal(isPaymentImportHeader("Amount_Paid"), true);
  assert.equal(isPaymentImportHeader("Committee"), false);
});
