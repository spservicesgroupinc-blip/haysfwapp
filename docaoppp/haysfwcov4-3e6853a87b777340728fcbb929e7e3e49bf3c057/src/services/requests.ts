import {
  newId,
  today,
  type ChangeRequest,
  type RequestedChange,
} from "../types";

export function createRequest(): ChangeRequest {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    customerCredits: false,
    id: newId(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    status: "submitted",
    estimatorName: "",
    submittedAt: null,
    informationQuestion: "",
    job: {
      customer: "",
      customerPhone: "",
      customerEmail: "",
      address: "",
      jobNumber: "",
      projectManager: "",
      branchName: "Hays + Sons Complete Restoration",
      branchAddress: "909 Production Road, Fort Wayne, IN 46808",
      branchPhone: "1-260-471-9110",
      branchContact: "",
      carrier: "",
      claim: "",
      orderNumber: "CO-01",
      date: today(),
      insuranceRelated: true,
      originalContract: "",
      previousChanges: "0.00",
      addedDays: "0",
    },
    requestedChanges: [],
    attachments: [],
  };
}

export function createRequestedChange(): RequestedChange {
  return {
    id: newId(),
    room: "",
    action: "add",
    description: "",
    reason: "",
    measurements: "",
    materials: "",
    scheduleImpact: "",
  };
}
