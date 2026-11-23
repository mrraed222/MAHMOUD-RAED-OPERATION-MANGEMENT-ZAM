import type { jsPDF } from 'npm:jspdf@4.2.1';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface ProfileActorRow {
  id: string;
  email: string | null;
  status: string | null;
}

export interface ReportCopyRecipientRow {
  profile_id: string;
  email: string;
  is_primary: boolean;
}

export interface ReportEmailSendClaim {
  decision: string;
  idempotency_key?: string | null;
  provider_message_id?: string | null;
}

export interface DailyReportRow {
  id: string;
  branch_id: string | null;
  submitted_by: string | null;
  supervisor_name: string | null;
  report_date: string | null;
  entry_time: string | null;
  shift_type: string | null;
  total_sales: number | null;
  orders_count: number | null;
  avg_ticket: number | null;
  team_status: string | null;
  positive_reviews: number | null;
  custom_fields: Json | null;
  created_at: string | null;
  branches: { name: string } | null;
}

export interface WasteLogRow {
  id?: string;
  report_id?: string | null;
  item_name: string;
  quantity: number;
  unit: string | null;
  reason: string | null;
  created_at: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  owner: string | null;
  unit_cost: number | null;
  sheet_key?: string | null;
  shift_type: string | null;
}

export interface ShiftIssueRow {
  id?: string;
  report_id?: string | null;
  issue_type: string | null;
  description: string;
  action_taken: string | null;
  priority: string | null;
  created_at: string | null;
  sheet_key?: string | null;
}

export interface NegativeReviewRow {
  id?: string;
  report_id?: string | null;
  comment_text: string;
  review_type: string | null;
  status: string | null;
  owner: string | null;
  action_taken: string | null;
  customer_rating: number | null;
  closed_at: string | null;
  created_at: string | null;
  sheet_key?: string | null;
}

export interface TechnicalIssueRow {
  id: string;
  report_id: string | null;
  title: string;
  description: string | null;
  source: string;
  priority: string;
  status: string;
  created_at: string | null;
  resolved_at: string | null;
}

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};
type Table<Row extends Record<string, unknown>, Relationships extends Relationship[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Relationships;
};
type ProfileDatabaseRow = ProfileActorRow & {
  full_name: string | null;
  role: string | null;
  branch_id: string | null;
  shift_type: string | null;
} & Record<string, unknown>;
type DailyReportDatabaseRow = Omit<DailyReportRow, 'branches'> & { sheet_key: string | null } & Record<string, unknown>;
type BranchRow = { id: string; name: string } & Record<string, unknown>;
type WasteDatabaseRow = WasteLogRow & { report_id: string | null } & Record<string, unknown>;
type ShiftIssueDatabaseRow = ShiftIssueRow & { report_id: string | null } & Record<string, unknown>;
type NegativeReviewDatabaseRow = NegativeReviewRow & { report_id: string | null } & Record<string, unknown>;
type TechnicalIssueDatabaseRow = TechnicalIssueRow & { branch_id: string; reported_by: string } & Record<string, unknown>;
type DailyReportBranchRelationship = {
  foreignKeyName: 'daily_reports_branch_id_fkey';
  columns: ['branch_id'];
  isOneToOne: false;
  referencedRelation: 'branches';
  referencedColumns: ['id'];
};
type ChildReportRelationship = {
  foreignKeyName: string;
  columns: ['report_id'];
  isOneToOne: false;
  referencedRelation: 'daily_reports';
  referencedColumns: ['id'];
};

type SendReportDatabase = {
  public: {
    Tables: {
      profiles: Table<ProfileDatabaseRow>;
      branches: Table<BranchRow>;
      daily_reports: Table<DailyReportDatabaseRow, [DailyReportBranchRelationship]>;
      waste_logs: Table<WasteDatabaseRow, [ChildReportRelationship]>;
      shift_issues: Table<ShiftIssueDatabaseRow, [ChildReportRelationship]>;
      negative_reviews: Table<NegativeReviewDatabaseRow, [ChildReportRelationship]>;
      technical_issues: Table<TechnicalIssueDatabaseRow>;
    };
    Views: Record<never, never>;
    Functions: {
      can_manager_read_branch: {
        Args: { p_permission: string; p_branch_id: string | null };
        Returns: boolean;
      };
      get_daily_report_copy_recipients: {
        Args: { p_report_id: string };
        Returns: ReportCopyRecipientRow[];
      };
      claim_daily_report_email_send: {
        Args: { p_report_id: string; p_payload_sha256: string };
        Returns: ReportEmailSendClaim;
      };
      finish_daily_report_email_send: {
        Args: {
          p_report_id: string;
          p_payload_sha256: string;
          p_state: string;
          p_provider_message_id?: string | null;
        };
        Returns: undefined;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export type { SendReportDatabase };

export interface BuildDailyReportPdfInput {
  jsPDF: typeof jsPDF;
  fontBase64: string;
  report: DailyReportRow;
  branchName: string;
  waste?: WasteLogRow[];
  issues?: ShiftIssueRow[];
  reviews?: NegativeReviewRow[];
  technicalIssues?: TechnicalIssueRow[];
}
