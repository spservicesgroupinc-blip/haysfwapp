import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from '@tailwindcss/vite';
import { createWorkspaceDevApi, createCrmDevApi } from './scripts/workspace-dev-api.ts';

interface MockRequest {
  schemaVersion: 2;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  status: "submitted" | "in_review" | "needs_information" | "completed";
  estimatorName: string;
  submittedAt: string | null;
  informationQuestion: string;
  job: Record<string, any>;
  requestedChanges: any[];
  attachments: any[];
  [key: string]: any;
}

function localApiPlugin(): Plugin {
  const initialJobs = [
    {
      id: "j1",
      jobNumber: "F-26-0366-P",
      customer: "York Ridge Apartments",
      address: "1200 York St, Fort Wayne, IN 46802",
      projectManager: "Dana Whitfield",
      estimator: "Marcus Vance",
      status: "Active",
      customerPhone: "260-555-0144",
      customerEmail: "dana@yorkridge.example.com",
      contractAmount: "167045.81",
      active: true,
      updatedAt: "2026-10-01T12:00:00.000Z",
    },
    {
      id: "j2",
      jobNumber: "I-26-1042-W",
      customer: "Beacon Health Pavilion",
      address: "500 E Jefferson Blvd, South Bend, IN 46601",
      projectManager: "Sarah Jenkins",
      estimator: "Marcus Vance",
      status: "Active",
      customerPhone: "574-555-0199",
      customerEmail: "sjenkins@beacon.example.com",
      contractAmount: "84210.00",
      active: true,
      updatedAt: "2026-10-05T09:30:00.000Z",
    },
    {
      id: "j3",
      jobNumber: "F-26-0411-C",
      customer: "Summit City Commerce Center",
      address: "3100 Executive Pkwy, Fort Wayne, IN 46808",
      projectManager: "Dana Whitfield",
      estimator: "Marcus Vance",
      status: "Active",
      customerPhone: "260-555-0211",
      customerEmail: "facilities@summitcity.example.com",
      contractAmount: "215400.50",
      active: true,
      updatedAt: "2026-10-08T15:00:00.000Z",
    },
  ];

  let jobs = [...initialJobs];
  const requests: MockRequest[] = [
    {
      schemaVersion: 2,
      id: "req-1",
      revision: 1,
      createdAt: "2026-10-01T12:00:00.000Z",
      updatedAt: "2026-10-01T12:00:00.000Z",
      status: "submitted",
      estimatorName: "",
      submittedAt: "2026-10-01T12:00:00.000Z",
      informationQuestion: "",
      job: {
        customer: "York Ridge Apartments",
        customerPhone: "260-555-0144",
        customerEmail: "dana@yorkridge.example.com",
        address: "1200 York St, Fort Wayne, IN 46802",
        jobNumber: "F-26-0366-P",
        projectManager: "Dana Whitfield",
        branchName: "Hays + Sons Complete Restoration",
        branchAddress: "909 Production Road, Fort Wayne, IN 46808",
        branchPhone: "1-260-471-9110",
        branchContact: "",
        carrier: "State Farm",
        claim: "CLM-99201",
        orderNumber: "CO-01",
        date: "2026-10-01",
        insuranceRelated: true,
        originalContract: "167045.81",
        previousChanges: "0.00",
        addedDays: "0",
      },
      requestedChanges: [
        {
          id: "c1",
          room: "Kitchen",
          action: "add",
          description:
            "Wet insulation behind kitchen drywall requires removal and replacement.",
          reason: "Discovered moisture intrusion during demolition.",
          measurements: "12 LF x 8 FT",
          materials: "R-13 Kraft Faced Batt",
          scheduleImpact: "1 day",
        },
      ],
      attachments: [],
    },
    {
      schemaVersion: 2,
      id: "req-2",
      revision: 2,
      createdAt: "2026-10-05T09:30:00.000Z",
      updatedAt: "2026-10-06T14:15:00.000Z",
      status: "in_review",
      estimatorName: "Marcus Vance",
      submittedAt: "2026-10-05T09:30:00.000Z",
      informationQuestion: "",
      job: {
        customer: "Beacon Health Pavilion",
        customerPhone: "574-555-0199",
        customerEmail: "sjenkins@beacon.example.com",
        address: "500 E Jefferson Blvd, South Bend, IN 46601",
        jobNumber: "I-26-1042-W",
        projectManager: "Sarah Jenkins",
        branchName: "Hays + Sons Complete Restoration",
        branchAddress: "909 Production Road, Fort Wayne, IN 46808",
        branchPhone: "1-260-471-9110",
        branchContact: "",
        carrier: "Travelers",
        claim: "TRV-88319-A",
        orderNumber: "CO-02",
        date: "2026-10-05",
        insuranceRelated: true,
        originalContract: "84210.00",
        previousChanges: "0.00",
        addedDays: "2",
      },
      requestedChanges: [
        {
          id: "c2",
          room: "Suite 104 Entryway",
          action: "revise",
          description:
            "Upgrade commercial grade vinyl tile to match existing corridor transition.",
          reason: "Owner request for seamless aesthetic match.",
          measurements: "240 SF",
          materials: "Armstrong Commercial VCT",
          scheduleImpact: "0 days",
        },
      ],
      attachments: [],
    },
  ];

  const attachmentData = new Map<
    string,
    { name: string; mimeType: string; data: string }
  >();
  const workspaceApi = createWorkspaceDevApi(requests);
  const crmApi = createCrmDevApi();

  function summarize(r: MockRequest) {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      revision: r.revision,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      status: r.status,
      estimatorName: r.estimatorName || "",
      changesCount: (r.requestedChanges || []).length,
      attachmentsCount: (r.attachments || []).length,
      job: {
        customer: r.job?.customer || "",
        jobNumber: r.job?.jobNumber || "",
        projectManager: r.job?.projectManager || "",
        orderNumber: r.job?.orderNumber || "",
        address: r.job?.address || "",
      },
    };
  }

  const handler = async (req: any, res: any, next: any) => {
    if (!req.url?.startsWith("/__api__")) {
      return next();
    }

    const url = new URL(req.url, "http://localhost:3000");
    let action = url.searchParams.get("action") || "";
    let body: any = {};

    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        body = JSON.parse(raw);
        action = body.action || action;
      } catch {
        body = {};
      }
    }

    const respond = (data: any, status = 200) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
    };

    try {
      const workspaceResult = workspaceApi(action, { ...Object.fromEntries(url.searchParams), ...body });
      if (workspaceResult !== undefined) return respond(workspaceResult);
      const crmResult = crmApi(action, { ...Object.fromEntries(url.searchParams), ...body });
      if (crmResult !== undefined) return respond(crmResult);

      if (action === "bootstrap") {
        return respond({
          ok: true,
          requests: requests.map(summarize),
          jobs,
        });
      }

      if (action === "listRequests") {
        return respond({
          ok: true,
          requests: requests.map(summarize),
        });
      }

      if (action === "listJobs") {
        return respond({ ok: true, jobs });
      }

      if (action === "openRequest") {
        const id = url.searchParams.get("id");
        const found = requests.find((r) => r.id === id);
        if (!found) {
          return respond({ ok: false, error: "Request not found" }, 404);
        }
        return respond({ ok: true, request: found });
      }

      if (action === "fetchAttachment") {
        const attachmentId = url.searchParams.get("attachmentId") || "";
        const item = attachmentData.get(attachmentId);
        if (!item) {
          return respond({ ok: false, error: "Attachment not found" }, 404);
        }
        return respond({ ok: true, ...item });
      }

      if (action === "saveRequest") {
        const incoming = body.request as MockRequest;
        const now = new Date().toISOString();
        const existingIdx = requests.findIndex((r) => r.id === incoming.id);
        if (existingIdx >= 0) {
          const updated = {
            ...incoming,
            revision: requests[existingIdx].revision + 1,
            updatedAt: now,
          };
          requests[existingIdx] = updated;
          return respond({ ok: true, request: updated });
        } else {
          const created: MockRequest = {
            ...incoming,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          };
          requests.unshift(created);
          return respond({ ok: true, request: created });
        }
      }

      if (action === "claimRequest") {
        const target = requests.find((r) => r.id === body.id);
        if (!target) {
          return respond({ ok: false, error: "Request not found" }, 404);
        }
        target.estimatorName = body.estimatorName || "";
        target.status = "in_review";
        target.revision += 1;
        target.updatedAt = new Date().toISOString();
        return respond({ ok: true, request: target });
      }

      if (action === "transitionRequest") {
        const target = requests.find((r) => r.id === body.id);
        if (!target) {
          return respond({ ok: false, error: "Request not found" }, 404);
        }
        target.status = body.status;
        if (body.question !== undefined) {
          target.informationQuestion = body.question;
        }
        target.revision += 1;
        target.updatedAt = new Date().toISOString();
        return respond({ ok: true, request: target });
      }

      if (action === "uploadAttachment") {
        const { requestId, attachmentId, file } = body;
        const target = requests.find((r) => r.id === requestId);
        if (!target) {
          return respond({ ok: false, error: "Request not found" }, 404);
        }
        const record = {
          id: attachmentId,
          kind: file.kind,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size,
          driveFileId: attachmentId,
        };
        attachmentData.set(attachmentId, {
          name: file.name,
          mimeType: file.mimeType,
          data: file.data,
        });
        target.attachments = [...(target.attachments || []), record];
        target.updatedAt = new Date().toISOString();
        return respond({ ok: true, attachment: record });
      }

      if (action === "importJobs") {
        if (Array.isArray(body.jobs)) {
          jobs = body.jobs;
        }
        return respond({ ok: true, jobs });
      }

      if (action === "sendEmail") {
        const { recipient, email } = body;
        const targetEmail = recipient || email || "";
        if (!targetEmail || !targetEmail.includes("@")) {
          return respond({ ok: false, error: "Please enter a valid email address." }, 400);
        }
        const target = requests.find((r) => r.id === body.requestId) || body.request;
        const count = target?.attachments?.length || 0;
        return respond({
          ok: true,
          recipient: targetEmail,
          attachmentCount: count,
          message: `Email sent successfully to ${targetEmail} with ${count} attachment(s).`,
        });
      }

      return respond({ ok: false, error: "Unknown action" }, 400);
    } catch (err: any) {
      return respond({ ok: false, error: err?.message || String(err) }, 500);
    }
  };

  return {
    name: "local-api-mock",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    localApiPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "logo.svg",
        "apple-touch-icon.png",
        "icons/apple-touch-icon.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/maskable-512.png",
      ],
      manifest: {
        id: "/",
        name: "Hays + Sons Change Orders",
        short_name: "ChangeOrders",
        description:
          "Quick change order intake and estimator review workflow.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#dc2626",
        shortcuts: [
          {
            name: "Quick request",
            short_name: "Quick request",
            url: "/#/simple",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
          },
        ],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Only hashed assets are precached. The document is handled by the
        // network-first route below so a shell cached by an older deployment can
        // never ask for files the newest deployment has already pruned.
        globPatterns: ["**/*.{js,css,svg,png,ico,woff2,ttf}"],
        cleanupOutdatedCaches: true,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              url.origin === self.location.origin,
            handler: "NetworkFirst",
            options: {
              cacheName: "hays-app-shell",
              networkTimeoutSeconds: 4,
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
        type: "module",
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
});
