import "server-only";
import { cache } from "react";
import { supabaseConfigured } from "@/lib/supabase/config";
import { builtinRepository } from "./builtin";
import { supabaseRepository } from "./supabase";
import type { Repository } from "./types";

/** The real built-in looks until Supabase is configured, so a clone runs with no setup. */
export const repository: Repository = supabaseConfigured() ? supabaseRepository : builtinRepository;

/** One lookup per request, shared by a page and its metadata. */
export const getOutfit = cache((id: string) => repository.getOutfit(id));
