import type { CollectionMemberScope } from "./api";

export const defaultCollectionScope: CollectionMemberScope = {scope:"all",groupIds:[],memberIds:[]};
export const validCollectionScope = (value:CollectionMemberScope) => value.scope==="all" ||
  (value.scope==="groups" ? value.groupIds.length>0 : value.memberIds.length>0);

