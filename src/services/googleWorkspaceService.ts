import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { RestorationJobData } from '../types/jobData';

// Scopes configured during OAuth setup
export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user && cachedAccessToken) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else if (user && !cachedAccessToken) {
      // Need token via popup if not in memory
      if (onAuthFailure) onAuthFailure();
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutGoogle = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

export const getCurrentUser = (): User | null => {
  return auth.currentUser;
};

/**
 * Uploads a generated PDF file to user's Google Drive inside a "Hays & Sons Restoration" folder
 */
export async function uploadPdfToGoogleDrive(
  pdfBytes: Uint8Array,
  fileName: string,
  folderName: string = 'Hays & Sons Restoration'
): Promise<{ fileId: string; webViewLink?: string }> {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in with Google first.');

  // 1. Search for existing parent folder or create one
  let folderId = '';
  const searchFolderRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(
      folderName
    )}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (searchFolderRes.ok) {
    const searchData = await searchFolderRes.json();
    if (searchData.files && searchData.files.length > 0) {
      folderId = searchData.files[0].id;
    }
  }

  if (!folderId) {
    // Create folder
    const createFolderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (createFolderRes.ok) {
      const folderData = await createFolderRes.json();
      folderId = folderData.id;
    }
  }

  // 2. Prepare multipart upload for PDF
  const metadata = {
    name: fileName,
    parents: folderId ? [folderId] : [],
    mimeType: 'application/pdf',
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadataString =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/pdf\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n';

  // Base64 encode the PDF bytes
  let binary = '';
  const len = pdfBytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  const base64Data = btoa(binary);

  const multipartRequestBody = metadataString + base64Data + closeDelimiter;

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json();
    throw new Error(err.error?.message || 'Failed to upload PDF to Google Drive');
  }

  const uploadedFile = await uploadRes.json();
  return {
    fileId: uploadedFile.id,
    webViewLink: uploadedFile.webViewLink,
  };
}

/**
 * Appends the job record to a Google Sheets tracking log
 */
export async function syncJobToGoogleSheets(
  job: RestorationJobData,
  spreadsheetTitle: string = 'Hays & Sons - Restoration Job Log'
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = await getAccessToken();
  if (!token) throw new Error('Please sign in with Google first.');

  // 1. Search for existing spreadsheet or create one
  let spreadsheetId = '';
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(
      spreadsheetTitle
    )}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false&fields=files(id,name,webViewLink)`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  let sheetUrl = '';
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      spreadsheetId = data.files[0].id;
      sheetUrl = data.files[0].webViewLink;
    }
  }

  const headersRow = [
    'Job #',
    'Date Logged',
    'Customer Name',
    'Phone',
    'Email',
    'Loss Address',
    'Carrier',
    'Claim #',
    'Adjuster',
    'Total Approved RCV',
    'Deductible',
    'Net Claim Value',
    'Down Payment (50%)',
    'Mid-Progress (25%)',
    'Estimator',
    'Project Manager',
    'Commence Days',
    'Complete Days',
  ];

  if (!spreadsheetId) {
    // Create new spreadsheet
    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: spreadsheetTitle,
        },
        sheets: [
          {
            properties: {
              title: 'Jobs',
              gridProperties: {
                frozenRowCount: 1,
              },
            },
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [
                  {
                    values: headersRow.map((h) => ({
                      userEnteredValue: { stringValue: h },
                    })),
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json();
      throw new Error(err.error?.message || 'Failed to create Google Spreadsheet');
    }

    const createdSheet = await createRes.json();
    spreadsheetId = createdSheet.spreadsheetId;
    sheetUrl = createdSheet.spreadsheetUrl;
  }

  // 2. Append the new row to the sheet
  const newRow = [
    job.customer.jobNumber,
    new Date().toLocaleDateString(),
    job.customer.customerName,
    job.customer.mobilePhone || job.customer.mainPhone,
    job.customer.email,
    job.customer.lossAddress,
    job.insurance.carrier,
    job.insurance.claimNumber,
    job.insurance.primaryAdjuster,
    typeof job.financials.totalApprovedRcv === 'number'
      ? `$${job.financials.totalApprovedRcv.toFixed(2)}`
      : '$0.00',
    typeof job.financials.deductible === 'number'
      ? `$${job.financials.deductible.toFixed(2)}`
      : '$0.00',
    `$${job.financials.netClaimValue.toFixed(2)}`,
    `$${job.financials.downPayment.toFixed(2)}`,
    `$${job.financials.midProgressPayment.toFixed(2)}`,
    job.team.estimator,
    job.team.projectManager,
    job.financials.commenceDays,
    job.financials.completeDays,
  ];

  const appendRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Jobs!A1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [newRow],
      }),
    }
  );

  if (!appendRes.ok) {
    const err = await appendRes.json();
    throw new Error(err.error?.message || 'Failed to append row to Google Sheet');
  }

  return {
    spreadsheetId,
    spreadsheetUrl: sheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}
