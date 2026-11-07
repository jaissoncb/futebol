// Domain row contracts shared with the Neon API. No database client or credentials.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      draw_runs: {
        Row: {
          accepted: boolean
          algorithm_version: string
          balance_score: number | null
          created_at: string
          group_id: string
          id: string
          match_id: string
          run_number: number
          seed: string
        }
      }
      group_members: {
        Row: {
          created_at: string
          group_id: string
          role: Database["public"]["Enums"]["group_role"]
          user_id: string
        }
      }
      groups: {
        Row: {
          created_at: string
          created_by: string
          default_players_on_court: number
          id: string
          name: string
          sport: string
          updated_at: string
        }
      }
      match_players: {
        Row: {
          attendance_status: Database["public"]["Enums"]["attendance_status"]
          created_at: string
          group_id: string
          is_goalkeeper_snapshot: boolean
          match_id: string
          player_id: string
          player_name_snapshot: string
          player_nickname_snapshot: string | null
          preferred_position_snapshot:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating_snapshot: number
        }
      }
      matches: {
        Row: {
          created_at: string
          created_by: string | null
          group_id: string
          id: string
          match_date: string
          match_time: string | null
          name: string | null
          players_on_court: number
          status: Database["public"]["Enums"]["match_status"]
          team_count: number
          updated_at: string
        }
      }
      players: {
        Row: {
          active: boolean
          created_at: string
          group_id: string
          id: string
          is_goalkeeper: boolean
          name: string
          nickname: string | null
          preferred_position:
            | Database["public"]["Enums"]["preferred_position"]
            | null
          skill_rating: number
          updated_at: string
        }
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
      }
      team_assignments: {
        Row: {
          assignment_source: Database["public"]["Enums"]["assignment_source"]
          created_at: string
          group_id: string
          id: string
          match_id: string
          player_id: string
          starts_as_reserve: boolean
          team_id: string
          updated_at: string
        }
      }
      teams: {
        Row: {
          color: string | null
          created_at: string
          group_id: string
          id: string
          match_id: string
          name: string
          team_index: number
        }
      }
    }
    Enums: {
      assignment_source: "draw" | "manual"
      attendance_status: "pending" | "present" | "absent"
      group_role: "owner" | "admin" | "member"
      match_status: "draft" | "drawn" | "completed" | "cancelled"
      preferred_position:
        | "goalkeeper"
        | "defense"
        | "midfield"
        | "attack"
        | "any"
    }
  }
}

export type Tables<Name extends keyof Database['public']['Tables']> = Database['public']['Tables'][Name]['Row']
