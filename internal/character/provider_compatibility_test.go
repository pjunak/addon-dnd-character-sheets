package character

import (
	"bytes"
	"context"
	"errors"
	"testing"

	model "github.com/pjunak/addon-dnd-engine/character"
	"github.com/pjunak/ttrpg-codex/sdk/go/workerrpc"
)

type providerCall func(context.Context, *workerrpc.Meta, workerrpc.ServiceCall) (workerrpc.ServiceResult, error)

func (call providerCall) Call(ctx context.Context, meta *workerrpc.Meta, request workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
	return call(ctx, meta, request)
}

func TestIncompatibleProviderPreservesSavedReadingAndRejectsEdits(t *testing.T) {
	for _, scenario := range []string{"malformed-result", "response-version", "evaluation-version", "broker-validation", "broker-request"} {
		t.Run(scenario, func(t *testing.T) {
			c, data, engine, meta := fixture(t)
			input := model.Blank()
			input.Notes = "Keep this character"
			saved, err := invoke(t, c, meta, "save", Request{Operation: "build", OperationID: "initial-character", Summary: "Create", Inputs: &input})
			if err != nil || saved.Status != "ready" {
				t.Fatalf("seed: %+v %v", saved, err)
			}
			before := raw(saved.State)
			c.engine = providerCall(func(ctx context.Context, meta *workerrpc.Meta, request workerrpc.ServiceCall) (workerrpc.ServiceResult, error) {
				if scenario == "broker-validation" || scenario == "broker-request" {
					kind := workerrpc.KindValidationFailed
					if scenario == "broker-request" {
						kind = workerrpc.KindInvalidRequest
					}
					return workerrpc.ServiceResult{}, failure(kind, "Provider contract rejected the call")
				}
				result, err := engine.Call(ctx, meta, request)
				if scenario == "malformed-result" {
					result.Result = []byte(`{"broken":true}`)
				} else {
					var value evaluated
					if err := decode(result.Result, &value); err != nil {
						t.Fatal(err)
					}
					if scenario == "response-version" {
						value.ContractVersion = "rules-character-response.v99"
					} else {
						value.Evaluation.ContractVersion = "character-inputs.v99"
					}
					result.Result = raw(value)
				}
				return result, err
			})
			loaded, err := invoke(t, c, meta, "load", Request{})
			if err != nil || loaded.Status != "unavailable" || loaded.Revision != saved.Revision || !bytes.Equal(raw(loaded.State), before) {
				t.Fatalf("incompatible provider hid or changed the saved character: %+v %v", loaded, err)
			}
			for _, method := range []string{"evaluate", "preview", "save"} {
				_, err := invoke(t, c, meta, method, Request{Operation: "build", OperationID: "rejected-character", Summary: "Edit", ExpectedRevision: saved.Revision, Inputs: &input})
				var rpcError *workerrpc.RPCError
				if !errors.As(err, &rpcError) || rpcError.Data == nil ||
					(rpcError.Data.Kind != workerrpc.KindValidationFailed && rpcError.Data.Kind != workerrpc.KindInvalidRequest) {
					t.Fatalf("%s swallowed a provider validation error: %v", method, err)
				}
			}
			if data.writes != 1 || data.revision != saved.Revision || !bytes.Equal(raw(data.state), before) {
				t.Fatal("read or rejected edits changed persisted state")
			}
			notes := saved.State.Inputs
			notes.Notes = "Offline session notes"
			updated, err := invoke(t, c, meta, "save", Request{Operation: "notes", OperationID: "offline-notes", Summary: "Session notes", ExpectedRevision: saved.Revision, Inputs: &notes})
			if err != nil || updated.Status != "ready" || updated.State.Inputs.Notes != notes.Notes ||
				!bytes.Equal(raw(updated.State.Projection), raw(saved.State.Projection)) ||
				!bytes.Equal(raw(updated.State.Rules), raw(saved.State.Rules)) || data.writes != 2 {
				t.Fatalf("offline notes did not preserve accepted mechanics: %+v %v", updated, err)
			}
		})
	}
}
