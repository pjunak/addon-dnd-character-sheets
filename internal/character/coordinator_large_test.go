package character

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

type largeProjectionEngine struct{ *fakeEngine }

func (engine largeProjectionEngine) Call(ctx context.Context, meta *workerrpc.Meta, call workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
	response, err := engine.fakeEngine.Call(ctx, meta, call)
	if err != nil {
		return response, err
	}
	var result evaluated
	if err := json.Unmarshal(response.Result, &result); err != nil {
		return response, err
	}
	fields := map[string]any{}
	for i := 0; i < 600; i++ {
		fields[fmt.Sprintf("stat-%03d", i)] = len(result.Evaluation.Inputs.Notes)
	}
	result.Evaluation.Sheet["derived"] = fields
	response.Result = raw(result)
	return response, nil
}

func TestLargeProjectionSaveAcknowledgesWithoutReviewDiff(t *testing.T) {
	original, data, engine, meta := fixture(t)
	c := New(data, largeProjectionEngine{engine})
	c.now = original.now
	input := model.Blank()
	request := Request{Operation: "build", OperationID: "large-initial", Summary: "Create", Inputs: &input}
	first, err := invoke(t, c, meta, "save", request)
	if err != nil || first.Status != "ready" {
		t.Fatalf("initial: %+v %v", first, err)
	}
	input.Notes = "Keep every value"
	request.OperationID = "large-change"
	request.ExpectedRevision = first.Revision
	saved, err := invoke(t, c, meta, "save", request)
	if err != nil || saved.Status != "ready" || saved.Revision != first.Revision+1 || len(saved.Changes) != 0 || saved.State == nil || len(saved.State.Projection.Sheet["derived"].(map[string]any)) != 600 {
		t.Fatalf("large save did not produce a bounded acknowledgment: %+v %v", saved, err)
	}
	retry, err := invoke(t, c, meta, "save", request)
	if err != nil || retry.Revision != saved.Revision || data.writes != 2 || !reflect.DeepEqual(raw(retry.State), raw(saved.State)) {
		t.Fatal("large save retry changed state", err)
	}
	input.Notes = "Reviewed import with different generated results"
	preview := review(t, c, meta, Request{Operation: "import", OperationID: "large-import", Summary: "Replace after review", ExpectedRevision: saved.Revision, Inputs: &input})
	if len(preview.Changes) == 0 || len(preview.Changes) > 500 || data.writes != 2 {
		t.Fatal("review missing, oversized or wrote state")
	}
	found := false
	for _, change := range preview.Changes {
		if change.Path == "/projection/sheet/derived" {
			found = true
			if len(change.Before.(map[string]any)) != 600 || len(change.After.(map[string]any)) != 600 {
				t.Fatal("grouping dropped changed statistics")
			}
		}
	}
	if !found {
		t.Fatal("large projection changes must remain reviewable")
	}
	committed, err := invoke(t, c, meta, "commit", Request{Token: preview.Token, OperationID: "large-import", ExpectedRevision: saved.Revision})
	if err != nil || committed.State.Inputs.Notes != input.Notes || data.writes != 3 {
		t.Fatal("review did not commit its exact state", err)
	}
}

func TestReviewDiffRetainsAllValuesWhenSeveralGroupsExceedTheLimit(t *testing.T) {
	before := &State{Inputs: model.Blank(), Rules: RulesContext{Identity: map[string]any{}}, Projection: Projection{Sheet: map[string]any{"derived": map[string]any{}}}}
	after := &State{Inputs: model.Blank(), Rules: RulesContext{Identity: map[string]any{}}, Projection: Projection{Sheet: map[string]any{"derived": map[string]any{}}}}
	for i := 0; i < 600; i++ {
		key := fmt.Sprintf("value-%03d", i)
		before.Inputs.Play.ResourceUses[key] = 0
		after.Inputs.Play.ResourceUses[key] = 1
		before.Rules.Identity[key] = 0
		after.Rules.Identity[key] = 1
		before.Projection.Sheet["derived"].(map[string]any)[key] = 0
		after.Projection.Sheet["derived"].(map[string]any)[key] = 1
	}
	changes := diff(before, after)
	if len(changes) != 3 {
		t.Fatal("expected three complete bounded groups", len(changes))
	}
	for _, change := range changes {
		left, right := change.Before.(map[string]any), change.After.(map[string]any)
		if len(left) != 600 || len(right) != 600 {
			t.Fatal("diff truncated a group", change.Path)
		}
		for key, value := range left {
			if value != float64(0) || right[key] != float64(1) {
				t.Fatal("changed values were lost", key)
			}
		}
	}
	if !reflect.DeepEqual(changes, diff(before, after)) {
		t.Fatal("grouped review is not deterministic")
	}
}
